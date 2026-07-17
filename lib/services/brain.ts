import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { canViewAccount, isInternal, type Viewer } from "@/lib/access";
import { db } from "@/lib/db";
import {
  brainSuggestions,
  brainVersions,
  clientBrains,
  type BrainSuggestion,
  type ClientBrain,
} from "@/lib/db/schema";
import { err, ok, type Result } from "@/lib/result";

export const brainInput = z.object({
  offer: z.string().max(4000).nullish(),
  icp: z.string().max(4000).nullish(),
  positioning: z.string().max(4000).nullish(),
  voice: z
    .object({
      do: z.array(z.string().max(500)).max(30).default([]),
      dont: z.array(z.string().max(500)).max(30).default([]),
      samples: z.array(z.string().max(1000)).max(20).default([]),
    })
    .partial()
    .nullish(),
  objections: z.array(z.string().max(1000)).max(50).nullish(),
  proofPoints: z.array(z.string().max(1000)).max(50).nullish(),
  complianceNos: z.array(z.string().max(1000)).max(50).nullish(),
  goalsCurrentQuarter: z.string().max(4000).nullish(),
});

function guard(viewer: Viewer, accountId: string): Result<true> {
  if (!isInternal(viewer)) return err("forbidden", "The Brain is internal");
  if (!canViewAccount(viewer, accountId)) return err("not_found", "Account not found");
  return ok(true);
}

/** Get the Brain, creating an empty one on first read. */
export async function getBrain(viewer: Viewer, accountId: string): Promise<Result<ClientBrain>> {
  const g = guard(viewer, accountId);
  if (!g.ok) return g as Result<never>;
  const [existing] = await db.select().from(clientBrains).where(eq(clientBrains.accountId, accountId));
  if (existing) return ok(existing);
  const [created] = await db.insert(clientBrains).values({ accountId }).returning();
  return ok(created!);
}

/** Patch the Brain; every write snapshots the prior state into brain_versions. */
export async function updateBrain(
  viewer: Viewer,
  accountId: string,
  input: z.infer<typeof brainInput>,
): Promise<Result<ClientBrain>> {
  const current = await getBrain(viewer, accountId);
  if (!current.ok) return current;

  // snapshot before mutating (version history, docs/08)
  await db.insert(brainVersions).values({
    accountId,
    version: current.value.version,
    snapshot: current.value,
  });

  const patch: Partial<typeof clientBrains.$inferInsert> = {
    version: current.value.version + 1,
    updatedBy: viewer.id,
    updatedAt: new Date(),
  };
  if (input.offer !== undefined) patch.offer = input.offer ?? null;
  if (input.icp !== undefined) patch.icp = input.icp ?? null;
  if (input.positioning !== undefined) patch.positioning = input.positioning ?? null;
  if (input.voice !== undefined) patch.voice = input.voice ?? {};
  if (input.objections !== undefined) patch.objections = input.objections ?? [];
  if (input.proofPoints !== undefined) patch.proofPoints = input.proofPoints ?? [];
  if (input.complianceNos !== undefined) patch.complianceNos = input.complianceNos ?? [];
  if (input.goalsCurrentQuarter !== undefined) patch.goalsCurrentQuarter = input.goalsCurrentQuarter ?? null;

  const [row] = await db
    .update(clientBrains)
    .set(patch)
    .where(eq(clientBrains.accountId, accountId))
    .returning();
  return ok(row!);
}

// ===== Suggestion queue (the Brain never self-edits silently, docs/08) =====

export async function listSuggestions(
  viewer: Viewer,
  accountId: string,
): Promise<Result<BrainSuggestion[]>> {
  const g = guard(viewer, accountId);
  if (!g.ok) return g as Result<never>;
  return ok(
    await db
      .select()
      .from(brainSuggestions)
      .where(and(eq(brainSuggestions.accountId, accountId), eq(brainSuggestions.status, "pending")))
      .orderBy(desc(brainSuggestions.createdAt)),
  );
}

export async function decideSuggestion(
  viewer: Viewer,
  suggestionId: string,
  decision: "accepted" | "rejected",
): Promise<Result<BrainSuggestion>> {
  const [suggestion] = await db
    .select()
    .from(brainSuggestions)
    .where(eq(brainSuggestions.id, suggestionId));
  if (!suggestion) return err("not_found", "Suggestion not found");
  const g = guard(viewer, suggestion.accountId);
  if (!g.ok) return g as Result<never>;
  if (suggestion.status !== "pending") return err("conflict", "Already decided");
  // Intake batches must go through the review/commit screen (docs/10) — a
  // blind accept here would write the whole Brain unreviewed.
  if (suggestion.field === "intake" && decision === "accepted") {
    return err("invalid", "Intake submissions are committed from the onboarding review screen");
  }

  if (decision === "accepted") {
    // Apply to the Brain. Week 8 scope: learnings + objections append.
    const brain = await getBrain(viewer, suggestion.accountId);
    if (!brain.ok) return brain as Result<never>;
    const proposed = suggestion.proposed as { text?: string };
    if (suggestion.field === "learnings" && proposed.text) {
      const learnings = [...((brain.value.learnings as unknown[]) ?? [])];
      learnings.push({ text: proposed.text, source: suggestion.source, added_at: new Date().toISOString() });
      await db.insert(brainVersions).values({
        accountId: suggestion.accountId,
        version: brain.value.version,
        snapshot: brain.value,
      });
      await db
        .update(clientBrains)
        .set({ learnings, version: brain.value.version + 1, updatedBy: viewer.id, updatedAt: new Date() })
        .where(eq(clientBrains.accountId, suggestion.accountId));
    } else if (suggestion.field === "objections" && proposed.text) {
      const objections = [...((brain.value.objections as unknown[]) ?? []), proposed.text];
      await db
        .update(clientBrains)
        .set({ objections, version: brain.value.version + 1, updatedBy: viewer.id, updatedAt: new Date() })
        .where(eq(clientBrains.accountId, suggestion.accountId));
    }
  }

  const [row] = await db
    .update(brainSuggestions)
    .set({ status: decision })
    .where(eq(brainSuggestions.id, suggestionId))
    .returning();
  return ok(row!);
}

/**
 * Meeting bridge (docs/08): when meeting notes land with decisions, propose
 * each as a Brain learning for the meeting's account. Called from applyNotes.
 */
export async function suggestFromMeeting(
  accountId: string,
  meetingId: string,
  decisions: string[],
): Promise<number> {
  let created = 0;
  for (const decision of decisions.slice(0, 10)) {
    await db.insert(brainSuggestions).values({
      accountId,
      field: "learnings",
      proposed: { text: decision, source: "meeting" },
      source: "meeting",
      sourceId: meetingId,
    });
    created++;
  }
  return created;
}
