import { and, desc, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { canViewAccount, isInternal, type Viewer } from "@/lib/access";
import { db } from "@/lib/db";
import { hooks, type Hook } from "@/lib/db/schema";
import { err, ok, type Result } from "@/lib/result";
import { embedText } from "@/lib/embeddings";

export const HOOK_FORMATS = [
  "question", "callout", "stat", "story_open", "contrarian", "pain", "curiosity", "social_proof",
] as const;

export const hookInput = z.object({
  text: z.string().trim().min(1).max(2000),
  format: z.enum(HOOK_FORMATS),
  platform: z.string().max(50).nullish(),
  nicheTags: z.array(z.string().max(50)).max(20).default([]),
  source: z.enum(["manual", "swipe", "our_ad", "organic", "import"]).default("manual"),
  sourceUrl: z.string().url().max(1000).nullish(),
  accountId: z.string().uuid().nullish(), // null = global library
  metrics: z.record(z.string(), z.number()).nullish(),
});

export const hookFilters = z.object({
  format: z.enum(HOOK_FORMATS).optional(),
  platform: z.string().max(50).optional(),
  niche: z.string().max(50).optional(),
  q: z.string().max(500).optional(), // semantic + filter search
  account: z.string().uuid().optional(),
});

function guard(viewer: Viewer): Result<true> {
  // Intelligence is the agency's knowledge layer — internal only (docs/08;
  // clients never see the hooks library or cross-client material).
  if (!isInternal(viewer)) return err("forbidden", "Intelligence is internal");
  return ok(true);
}

export async function createHook(viewer: Viewer, input: z.infer<typeof hookInput>): Promise<Result<Hook>> {
  const g = guard(viewer);
  if (!g.ok) return g as Result<never>;
  if (input.accountId && !canViewAccount(viewer, input.accountId)) return err("not_found", "Account not found");

  // Embed inline: single short text, well under the 2s job threshold.
  const embedding = await embedText(input.text);
  const [row] = await db
    .insert(hooks)
    .values({
      text: input.text,
      format: input.format,
      platform: input.platform ?? null,
      nicheTags: input.nicheTags,
      source: input.source,
      sourceUrl: input.sourceUrl ?? null,
      accountId: input.accountId ?? null,
      metrics: input.metrics ?? null,
      embedding,
      createdBy: viewer.id,
    })
    .returning();
  return ok(row!);
}

export type HookHit = Hook & { similarity: number | null };

/**
 * Hooks search (docs/08): filters + semantic ranking. With `q`, results are
 * ordered by cosine similarity to the query embedding (pgvector); without it,
 * newest first. Scope: global hooks + optionally one account's hooks.
 */
export async function searchHooks(
  viewer: Viewer,
  filters: z.infer<typeof hookFilters>,
): Promise<Result<HookHit[]>> {
  const g = guard(viewer);
  if (!g.ok) return g as Result<never>;
  if (filters.account && !canViewAccount(viewer, filters.account)) return err("not_found", "Account not found");

  const conds: (SQL | undefined)[] = [
    filters.account
      ? or(isNull(hooks.accountId), eq(hooks.accountId, filters.account))
      : undefined,
  ];
  if (filters.format) conds.push(eq(hooks.format, filters.format));
  if (filters.platform) conds.push(eq(hooks.platform, filters.platform));
  if (filters.niche) conds.push(sql`${filters.niche} = any(${hooks.nicheTags})`);

  if (filters.q?.trim()) {
    const qvec = await embedText(filters.q);
    const vecLiteral = `[${qvec.join(",")}]`;
    const rows = await db
      .select({
        hook: hooks,
        similarity: sql<number>`1 - (${hooks.embedding} <=> ${vecLiteral}::vector)`,
      })
      .from(hooks)
      .where(and(sql`${hooks.embedding} is not null`, ...conds.filter(Boolean)))
      .orderBy(sql`${hooks.embedding} <=> ${vecLiteral}::vector`)
      .limit(20);
    return ok(rows.map((r) => ({ ...r.hook, similarity: r.similarity })));
  }

  const rows = await db
    .select()
    .from(hooks)
    .where(conds.some(Boolean) ? and(...conds.filter(Boolean)) : undefined)
    .orderBy(desc(hooks.createdAt))
    .limit(50);
  return ok(rows.map((h) => ({ ...h, similarity: null })));
}

/** Bulk CSV import: text,format,platform,niche_tags("a|b"),source_url */
export async function importHooks(
  viewer: Viewer,
  rows: Record<string, string>[],
): Promise<Result<{ imported: number; skipped: number }>> {
  const g = guard(viewer);
  if (!g.ok) return g as Result<never>;
  let imported = 0;
  let skipped = 0;
  for (const raw of rows.slice(0, 1000)) {
    const parsed = hookInput.safeParse({
      text: raw.text,
      format: raw.format,
      platform: raw.platform || null,
      nicheTags: raw.niche_tags ? raw.niche_tags.split("|").map((t) => t.trim()).filter(Boolean) : [],
      source: "import",
      sourceUrl: raw.source_url || null,
    });
    if (!parsed.success) {
      skipped++;
      continue;
    }
    const embedding = await embedText(parsed.data.text);
    await db.insert(hooks).values({
      text: parsed.data.text,
      format: parsed.data.format,
      platform: parsed.data.platform ?? null,
      nicheTags: parsed.data.nicheTags,
      source: "import",
      sourceUrl: parsed.data.sourceUrl ?? null,
      embedding,
      createdBy: viewer.id,
    });
    imported++;
  }
  return ok({ imported, skipped });
}
