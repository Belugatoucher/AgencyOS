import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { canViewAccount, isInternal, type Viewer } from "@/lib/access";
import { db } from "@/lib/db";
import { pipelines, stages, leads, type Pipeline, type Stage } from "@/lib/db/schema";
import { err, ok, type Result } from "@/lib/result";

// Default stages seeded per pipeline (docs/02), editable afterward.
const DEFAULT_STAGES: { name: string; color: string; isWon?: boolean; isLost?: boolean }[] = [
  { name: "New", color: "#64748b" },
  { name: "Contacted", color: "#3b82f6" },
  { name: "Qualified", color: "#8b5cf6" },
  { name: "Proposal", color: "#d97706" },
  { name: "Won", color: "#16a34a", isWon: true },
  { name: "Lost", color: "#dc2626", isLost: true },
];

export const pipelineInput = z.object({
  // Every pipeline belongs to an account (db/006). The agency's own prospect
  // pipeline lives under the agency's internal account, not a null account.
  accountId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
});

export const stageInput = z.object({
  name: z.string().trim().min(1).max(100),
  color: z.string().max(32).optional(),
  isWon: z.boolean().default(false),
  isLost: z.boolean().default(false),
});

export type PipelineWithStages = Pipeline & { stages: Stage[] };

function guardAccount(viewer: Viewer, accountId: string): Result<true> {
  // Leads are an internal tool in week 1; the client portal leads page (doc 11)
  // is deferred. Only internal users touch pipelines/stages/leads.
  if (!isInternal(viewer)) return err("forbidden", "Leads are internal");
  if (!canViewAccount(viewer, accountId)) return err("not_found", "Account not found");
  return ok(true);
}

export async function createPipeline(
  viewer: Viewer,
  input: z.infer<typeof pipelineInput>,
): Promise<Result<PipelineWithStages>> {
  const guard = guardAccount(viewer, input.accountId);
  if (!guard.ok) return guard as Result<never>;

  const [pipeline] = await db
    .insert(pipelines)
    .values({ accountId: input.accountId, name: input.name })
    .returning();

  const seeded = await db
    .insert(stages)
    .values(
      DEFAULT_STAGES.map((s, i) => ({
        pipelineId: pipeline!.id,
        name: s.name,
        color: s.color,
        position: i,
        isWon: s.isWon ?? false,
        isLost: s.isLost ?? false,
      })),
    )
    .returning();

  return ok({ ...pipeline!, stages: seeded });
}

export async function listPipelines(
  viewer: Viewer,
  accountId: string,
): Promise<Result<PipelineWithStages[]>> {
  const guard = guardAccount(viewer, accountId);
  if (!guard.ok) return guard as Result<never>;

  const rows = await db
    .select()
    .from(pipelines)
    .where(eq(pipelines.accountId, accountId))
    .orderBy(asc(pipelines.position), asc(pipelines.name));

  const withStages = await Promise.all(
    rows.map(async (p) => ({
      ...p,
      stages: await db
        .select()
        .from(stages)
        .where(eq(stages.pipelineId, p.id))
        .orderBy(asc(stages.position)),
    })),
  );
  return ok(withStages);
}

export async function getPipeline(
  viewer: Viewer,
  pipelineId: string,
): Promise<Result<PipelineWithStages>> {
  if (!isInternal(viewer)) return err("forbidden", "Leads are internal");
  const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.id, pipelineId));
  if (!pipeline) return err("not_found", "Pipeline not found");
  if (!canViewAccount(viewer, pipeline.accountId)) return err("not_found", "Pipeline not found");
  const s = await db
    .select()
    .from(stages)
    .where(eq(stages.pipelineId, pipelineId))
    .orderBy(asc(stages.position));
  return ok({ ...pipeline, stages: s });
}

export async function addStage(
  viewer: Viewer,
  pipelineId: string,
  input: z.infer<typeof stageInput>,
): Promise<Result<Stage>> {
  const pipeline = await getPipeline(viewer, pipelineId);
  if (!pipeline.ok) return pipeline as Result<never>;
  const nextPos = pipeline.value.stages.length;
  const [row] = await db
    .insert(stages)
    .values({ pipelineId, position: nextPos, ...input })
    .returning();
  return ok(row!);
}

export async function deleteStage(
  viewer: Viewer,
  pipelineId: string,
  stageId: string,
): Promise<Result<{ deleted: true }>> {
  const pipeline = await getPipeline(viewer, pipelineId);
  if (!pipeline.ok) return pipeline as Result<never>;
  // Deleting a stage requires moving its leads first (docs/02).
  const [stuck] = await db
    .select({ id: leads.id })
    .from(leads)
    .where(eq(leads.stageUuid, stageId))
    .limit(1);
  if (stuck) return err("conflict", "Move this stage's leads before deleting it");
  await db.delete(stages).where(and(eq(stages.id, stageId), eq(stages.pipelineId, pipelineId)));
  return ok({ deleted: true });
}

/** Rotate a fresh public intake token for a pipeline (or disable with null). */
export async function setIntakeToken(
  viewer: Viewer,
  pipelineId: string,
  enabled: boolean,
): Promise<Result<Pipeline>> {
  const pipeline = await getPipeline(viewer, pipelineId);
  if (!pipeline.ok) return pipeline as Result<never>;
  const { randomBytes } = await import("node:crypto");
  // ≥128-bit CSPRNG token for the public endpoint (audit item 1/6).
  const token = enabled ? randomBytes(24).toString("base64url") : null;
  const [row] = await db
    .update(pipelines)
    .set({ intakeToken: token })
    .where(eq(pipelines.id, pipelineId))
    .returning();
  return ok(row!);
}
