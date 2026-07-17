import { and, desc, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { canViewAccount, isInternal, type Viewer } from "@/lib/access";
import { db } from "@/lib/db";
import { researchChunks, researchDocs, type ResearchDoc } from "@/lib/db/schema";
import { err, ok, type Result } from "@/lib/result";
import { chunkText, embedText, embedTexts } from "@/lib/embeddings";
import { getQueue } from "@/lib/queues";

export const RESEARCH_KINDS = ["competitor", "audience", "voc", "trend", "strategy"] as const;

export const researchInput = z.object({
  accountId: z.string().uuid().nullish(), // null = general market research
  kind: z.enum(RESEARCH_KINDS),
  title: z.string().trim().min(1).max(300),
  rawText: z.string().min(1).max(500_000), // paste path; file upload can follow
});

function guard(viewer: Viewer): Result<true> {
  if (!isInternal(viewer)) return err("forbidden", "Intelligence is internal");
  return ok(true);
}

/** Create a research doc and enqueue the chunk+embed job (docs/08 pipeline). */
export async function createResearch(
  viewer: Viewer,
  input: z.infer<typeof researchInput>,
): Promise<Result<ResearchDoc>> {
  const g = guard(viewer);
  if (!g.ok) return g as Result<never>;
  if (input.accountId && !canViewAccount(viewer, input.accountId)) return err("not_found", "Account not found");

  const [doc] = await db
    .insert(researchDocs)
    .values({
      accountId: input.accountId ?? null,
      kind: input.kind,
      title: input.title,
      rawText: input.rawText,
      status: "processing",
    })
    .returning();
  await getQueue("ai").add("embed-research", { docId: doc!.id });
  return ok(doc!);
}

export async function listResearch(viewer: Viewer, accountId?: string): Promise<Result<ResearchDoc[]>> {
  const g = guard(viewer);
  if (!g.ok) return g as Result<never>;
  const rows = await db
    .select()
    .from(researchDocs)
    .where(accountId ? or(isNull(researchDocs.accountId), eq(researchDocs.accountId, accountId)) : undefined)
    .orderBy(desc(researchDocs.createdAt))
    .limit(100);
  return ok(rows);
}

/** Worker job: chunk the doc's text, embed each chunk, mark ready|failed. */
export async function embedResearchDoc(docId: string): Promise<{ chunks: number }> {
  const [doc] = await db.select().from(researchDocs).where(eq(researchDocs.id, docId));
  if (!doc) throw new Error(`Research doc ${docId} not found`);
  try {
    if (!doc.rawText) throw new Error("No text to embed (file extraction lands with uploads)");
    const chunks = chunkText(doc.rawText);
    const embeddings = await embedTexts(chunks);
    // replace any prior chunks (reprocess-safe)
    await db.delete(researchChunks).where(eq(researchChunks.docId, docId));
    for (let i = 0; i < chunks.length; i++) {
      await db.insert(researchChunks).values({
        docId,
        chunkText: chunks[i]!,
        position: i,
        embedding: embeddings[i]!,
      });
    }
    await db.update(researchDocs).set({ status: "ready" }).where(eq(researchDocs.id, docId));
    return { chunks: chunks.length };
  } catch (e) {
    await db.update(researchDocs).set({ status: "failed" }).where(eq(researchDocs.id, docId));
    throw e;
  }
}

export type ChunkHit = {
  chunkId: string;
  docId: string;
  docTitle: string;
  kind: string;
  chunkText: string;
  similarity: number;
};

/**
 * Semantic search over research chunks: this account's material + the global
 * library (docs/08 retrieval scope). Used by the Brain's search_research tool.
 */
export async function searchResearch(
  viewer: Viewer,
  query: string,
  opts: { accountId?: string; kind?: string; limit?: number } = {},
): Promise<Result<ChunkHit[]>> {
  const g = guard(viewer);
  if (!g.ok) return g as Result<never>;
  if (opts.accountId && !canViewAccount(viewer, opts.accountId)) return err("not_found", "Account not found");

  const qvec = await embedText(query);
  const vecLiteral = `[${qvec.join(",")}]`;
  const conds: (SQL | undefined)[] = [
    sql`${researchChunks.embedding} is not null`,
    opts.accountId
      ? or(isNull(researchDocs.accountId), eq(researchDocs.accountId, opts.accountId))
      : undefined,
    opts.kind ? eq(researchDocs.kind, opts.kind) : undefined,
  ];
  const rows = await db
    .select({
      chunkId: researchChunks.id,
      docId: researchDocs.id,
      docTitle: researchDocs.title,
      kind: researchDocs.kind,
      chunkText: researchChunks.chunkText,
      similarity: sql<number>`1 - (${researchChunks.embedding} <=> ${vecLiteral}::vector)`,
    })
    .from(researchChunks)
    .innerJoin(researchDocs, eq(researchDocs.id, researchChunks.docId))
    .where(and(...conds.filter(Boolean)))
    .orderBy(sql`${researchChunks.embedding} <=> ${vecLiteral}::vector`)
    .limit(opts.limit ?? 6);
  return ok(rows);
}
