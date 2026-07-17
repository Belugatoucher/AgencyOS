import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { isInternal, type Viewer } from "@/lib/access";
import { db } from "@/lib/db";
import {
  kbChunks,
  meetingNotes,
  meetings,
  sops,
  sopVersions,
  tasks,
  type Sop,
} from "@/lib/db/schema";
import { chunkText, embedTexts } from "@/lib/embeddings";
import { getQueue } from "@/lib/queues";
import { err, ok, type Result } from "@/lib/result";
import { notify } from "@/lib/services/notifications";

// SOP library (docs/16): the written truth of how the agency works.
// Versioned like the Brain (snapshot on publish); published bodies are chunked
// by heading into kb_chunks — the Notebook's ONLY retrieval scope.

export const SOP_CATEGORIES = [
  "client_mgmt", "creative", "media_buying", "sales", "ops", "tools",
] as const;

export const sopInput = z.object({
  title: z.string().trim().min(1).max(300),
  category: z.enum(SOP_CATEGORIES),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  body: z.string().min(1).max(200_000),
  reviewEveryDays: z.number().int().min(7).max(730).default(180),
});

export const sopFilters = z.object({
  category: z.enum(SOP_CATEGORIES).optional(),
  status: z.enum(["draft", "published", "needs_review"]).optional(),
  tag: z.string().max(50).optional(),
  q: z.string().max(200).optional(),
});

function guard(viewer: Viewer): Result<true> {
  if (!isInternal(viewer)) return err("forbidden", "The SOP library is internal");
  return ok(true);
}

/** GitHub-style heading slug (docs/16 deep-linkable sections). */
export function headingSlug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/**
 * Split a markdown body into sections keyed by heading anchor. Content before
 * the first heading anchors to null (the doc top); long sections re-chunk.
 */
export function sectionize(body: string): { anchor: string | null; text: string }[] {
  const lines = body.split("\n");
  const sections: { anchor: string | null; text: string }[] = [];
  let anchor: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    const text = buf.join("\n").trim();
    if (text) for (const piece of chunkText(text)) sections.push({ anchor, text: piece });
    buf = [];
  };
  for (const line of lines) {
    const m = line.match(/^#{1,4}\s+(.+)$/);
    if (m) {
      flush();
      anchor = headingSlug(m[1]!);
      buf.push(line); // keep the heading inside its chunk for retrieval context
    } else {
      buf.push(line);
    }
  }
  flush();
  return sections;
}

export async function createSop(viewer: Viewer, input: z.infer<typeof sopInput>): Promise<Result<Sop>> {
  const g = guard(viewer);
  if (!g.ok) return g as Result<never>;
  const [row] = await db
    .insert(sops)
    .values({ ...input, ownerId: viewer.id })
    .returning();
  return ok(row!);
}

export async function listSops(viewer: Viewer, filters: z.infer<typeof sopFilters>): Promise<Result<Sop[]>> {
  const g = guard(viewer);
  if (!g.ok) return g as Result<never>;
  const conds: (SQL | undefined)[] = [];
  if (filters.category) conds.push(eq(sops.category, filters.category));
  if (filters.status) conds.push(eq(sops.status, filters.status));
  if (filters.tag) conds.push(sql`${filters.tag} = any(${sops.tags})`);
  if (filters.q) conds.push(or(ilike(sops.title, `%${filters.q}%`), ilike(sops.body, `%${filters.q}%`)));
  return ok(
    await db
      .select()
      .from(sops)
      .where(conds.length ? and(...conds.filter(Boolean)) : undefined)
      .orderBy(desc(sops.updatedAt))
      .limit(200),
  );
}

export async function getSop(viewer: Viewer, id: string): Promise<Result<Sop>> {
  const g = guard(viewer);
  if (!g.ok) return g as Result<never>;
  const [row] = await db.select().from(sops).where(eq(sops.id, id));
  if (!row) return err("not_found", "SOP not found");
  return ok(row);
}

/** Draft edits don't version; publishing snapshots (see publishSop). */
export async function updateSop(
  viewer: Viewer,
  id: string,
  input: Partial<z.infer<typeof sopInput>>,
): Promise<Result<Sop>> {
  const existing = await getSop(viewer, id);
  if (!existing.ok) return existing;
  const [row] = await db
    .update(sops)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(sops.id, id))
    .returning();
  // A published SOP edited in place stays published but re-chunks on next
  // publish; nudge authors through publishSop for real changes.
  return ok(row!);
}

/**
 * Publish: snapshot prior state to sop_versions, bump version, mark reviewed,
 * and enqueue chunk+embed into kb_chunks (docs/16 chunk-on-publish).
 */
export async function publishSop(viewer: Viewer, id: string): Promise<Result<Sop>> {
  const existing = await getSop(viewer, id);
  if (!existing.ok) return existing;
  await db.insert(sopVersions).values({
    sopId: id,
    version: existing.value.version,
    snapshot: existing.value,
  });
  const [row] = await db
    .update(sops)
    .set({
      status: "published",
      version: existing.value.version + 1,
      lastReviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(sops.id, id))
    .returning();
  await getQueue("ai").add("embed-sop", { sopId: id });
  return ok(row!);
}

/** Worker job: (re)chunk + embed a published SOP into kb_chunks. */
export async function embedSop(sopId: string): Promise<{ chunks: number }> {
  const [sop] = await db.select().from(sops).where(eq(sops.id, sopId));
  if (!sop) throw new Error(`SOP ${sopId} not found`);
  const sections = sectionize(sop.body);
  const embeddings = await embedTexts(sections.map((s) => s.text));
  await db.delete(kbChunks).where(and(eq(kbChunks.source, "sop"), eq(kbChunks.sourceId, sopId)));
  for (let i = 0; i < sections.length; i++) {
    await db.insert(kbChunks).values({
      source: "sop",
      sourceId: sopId,
      anchor: sections[i]!.anchor,
      chunkText: sections[i]!.text,
      embedding: embeddings[i]!,
    });
  }
  return { chunks: sections.length };
}

/** Reviewed = fresh again: clears needs_review without forcing a re-publish. */
export async function markReviewed(viewer: Viewer, id: string): Promise<Result<Sop>> {
  const existing = await getSop(viewer, id);
  if (!existing.ok) return existing;
  if (existing.value.status === "draft") return err("invalid", "Drafts aren't in review rotation");
  const [row] = await db
    .update(sops)
    .set({ status: "published", lastReviewedAt: new Date() })
    .where(eq(sops.id, id))
    .returning();
  return ok(row!);
}

/**
 * Staleness engine (docs/16, cron): published SOPs past their review interval
 * flip to needs_review and ping the owner. An SOP library that admits what it
 * doesn't know stays trusted.
 */
export async function sopStalenessSweep(now = new Date()): Promise<{ flagged: number }> {
  const rows = await db.select().from(sops).where(eq(sops.status, "published"));
  let flagged = 0;
  for (const sop of rows) {
    const basis = sop.lastReviewedAt ?? sop.updatedAt;
    const dueAt = new Date(basis.getTime() + sop.reviewEveryDays * 24 * 60 * 60 * 1000);
    if (dueAt < now) {
      await db.update(sops).set({ status: "needs_review" }).where(eq(sops.id, sop.id));
      flagged++;
      if (sop.ownerId) {
        void notify([sop.ownerId], {
          kind: "sop_stale",
          body: { sopId: sop.id, title: sop.title },
          slackText: `📚 SOP needs review: "${sop.title}" (past its ${sop.reviewEveryDays}-day interval)`,
        });
      }
    }
  }
  return { flagged };
}

// ---- Promote to SOP (docs/16: capture process the moment it exists) ----

export const promoteInput = z.object({
  source: z.enum(["meeting", "task"]),
  sourceId: z.string().uuid(),
  category: z.enum(SOP_CATEGORIES).default("ops"),
});

export async function promoteToSop(
  viewer: Viewer,
  input: z.infer<typeof promoteInput>,
): Promise<Result<Sop>> {
  const g = guard(viewer);
  if (!g.ok) return g as Result<never>;

  let title = "";
  let body = "";
  if (input.source === "meeting") {
    const [row] = await db
      .select({ meeting: meetings, notes: meetingNotes })
      .from(meetings)
      .leftJoin(meetingNotes, eq(meetingNotes.meetingId, meetings.id))
      .where(eq(meetings.id, input.sourceId));
    if (!row) return err("not_found", "Meeting not found");
    title = `SOP draft — ${row.meeting.title}`;
    const decisions = ((row.notes?.decisions ?? []) as string[]).map((d) => `- ${d}`).join("\n");
    body = [
      `# ${row.meeting.title}`,
      "",
      "## Summary",
      row.notes?.summary ?? "_No notes yet — write the process here._",
      "",
      "## Process / decisions",
      decisions || "- _Fill in the steps_",
    ].join("\n");
  } else {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, input.sourceId));
    if (!task) return err("not_found", "Task not found");
    title = `SOP draft — ${task.title}`;
    body = [`# ${task.title}`, "", "## Process", task.description ?? "_Write the steps here._"].join("\n");
  }

  const [row] = await db
    .insert(sops)
    .values({ title, category: input.category, body, ownerId: viewer.id, status: "draft" })
    .returning();
  return ok(row!);
}
