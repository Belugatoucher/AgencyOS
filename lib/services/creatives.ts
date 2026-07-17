import { and, desc, eq, type SQL } from "drizzle-orm";
import { z } from "zod";
import { canMutateAccount, canViewAccount, isInternal, type Viewer } from "@/lib/access";
import { db } from "@/lib/db";
import { brainSuggestions, creatives, type Creative } from "@/lib/db/schema";
import { err, ok, type Result } from "@/lib/result";
import { embedText } from "@/lib/embeddings";

export const creativeInput = z.object({
  accountId: z.string().uuid(),
  assetIds: z.array(z.string().uuid()).max(10).default([]),
  platform: z.string().trim().min(1).max(50),
  metrics: z.record(z.string(), z.number()).default({}),
  spendCents: z.number().int().min(0).default(0),
  learning: z.string().max(4000).nullish(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

function guard(viewer: Viewer): Result<true> {
  if (!isInternal(viewer)) return err("forbidden", "Intelligence is internal");
  return ok(true);
}

export async function createCreative(
  viewer: Viewer,
  input: z.infer<typeof creativeInput>,
): Promise<Result<Creative>> {
  const g = guard(viewer);
  if (!g.ok) return g as Result<never>;
  if (!canViewAccount(viewer, input.accountId)) return err("not_found", "Account not found");
  if (!canMutateAccount(viewer, input.accountId)) return err("forbidden", "Only the team can add creatives");

  const embedding = input.learning ? await embedText(input.learning) : null;
  const [row] = await db
    .insert(creatives)
    .values({
      accountId: input.accountId,
      assetIds: input.assetIds,
      platform: input.platform,
      metrics: input.metrics,
      spendCents: input.spendCents,
      learning: input.learning ?? null,
      embedding,
      periodStart: input.periodStart ?? null,
      periodEnd: input.periodEnd ?? null,
    })
    .returning();

  // A written learning proposes a Brain update (human approves — docs/08).
  if (input.learning) {
    await db.insert(brainSuggestions).values({
      accountId: input.accountId,
      field: "learnings",
      proposed: { text: input.learning, source: "creative" },
      source: "creative",
      sourceId: row!.id,
    });
  }
  return ok(row!);
}

export async function listCreatives(
  viewer: Viewer,
  accountId: string,
  opts: { platform?: string; winningOnly?: boolean } = {},
): Promise<Result<Creative[]>> {
  const g = guard(viewer);
  if (!g.ok) return g as Result<never>;
  if (!canViewAccount(viewer, accountId)) return err("not_found", "Account not found");
  const conds: (SQL | undefined)[] = [eq(creatives.accountId, accountId)];
  if (opts.platform) conds.push(eq(creatives.platform, opts.platform));
  if (opts.winningOnly) conds.push(eq(creatives.isWinning, true));
  const rows = await db
    .select()
    .from(creatives)
    .where(and(...conds.filter(Boolean)))
    .orderBy(desc(creatives.createdAt))
    .limit(100);
  return ok(rows);
}

/**
 * Top-quartile winner selection on the primary KPI with a minimum spend
 * threshold (docs/08 + docs/09) — computed, not vibes. Pure, so it's testable.
 */
export function computeWinnerIds(
  rows: { id: string; spendCents: number; metrics: unknown }[],
  primaryKpi: string,
  minSpendCents: number,
): Set<string> {
  const eligible = rows.filter(
    (c) =>
      c.spendCents >= minSpendCents &&
      typeof (c.metrics as Record<string, number>)[primaryKpi] === "number",
  );
  if (eligible.length === 0) return new Set();
  const values = eligible
    .map((c) => (c.metrics as Record<string, number>)[primaryKpi]!)
    .sort((a, b) => a - b);
  // top quartile = best ceil(n/4) creatives; ties at the cutoff all count
  const cutoff = values[values.length - Math.ceil(values.length / 4)]!;
  return new Set(
    eligible.filter((c) => (c.metrics as Record<string, number>)[primaryKpi]! >= cutoff).map((c) => c.id),
  );
}

/** Recompute is_winning for an account and persist changed flags. */
export async function recomputeWinning(
  accountId: string,
  opts: { primaryKpi?: string; minSpendCents?: number } = {},
): Promise<{ winners: number; total: number }> {
  const primaryKpi = opts.primaryKpi ?? "roas";
  const minSpend = opts.minSpendCents ?? 10_000; // $100 default floor

  const rows = await db.select().from(creatives).where(eq(creatives.accountId, accountId));
  const winnerIds = computeWinnerIds(rows, primaryKpi, minSpend);
  for (const c of rows) {
    const isWinning = winnerIds.has(c.id);
    if (isWinning !== c.isWinning) {
      await db.update(creatives).set({ isWinning }).where(eq(creatives.id, c.id));
    }
  }
  return { winners: winnerIds.size, total: rows.length };
}

