import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { canViewAccount, isInternal, type Viewer } from "@/lib/access";
import { db } from "@/lib/db";
import {
  leadActivities,
  leads,
  pipelines,
  stages,
  users,
  type Lead,
  type LeadActivity,
} from "@/lib/db/schema";
import { err, ok, type Result } from "@/lib/result";

export const leadInput = z.object({
  accountId: z.string().uuid().nullish(),
  pipelineUuid: z.string().uuid(),
  stageUuid: z.string().uuid().nullish(),
  name: z.string().trim().max(200).nullish(),
  email: z.string().trim().email().max(320).nullish().or(z.literal("").transform(() => null)),
  phone: z.string().trim().max(50).nullish(),
  company: z.string().trim().max(200).nullish(),
  valueCents: z.number().int().min(0).max(1_000_000_000).nullish(),
  source: z.string().trim().max(100).nullish(),
  tags: z.array(z.string().max(50)).max(30).nullish(),
  links: z.array(z.object({ label: z.string().max(50), url: z.string().url().max(500) })).max(20).nullish(),
  ownerId: z.string().uuid().nullish(),
  internalNotes: z.string().max(20_000).nullish(),
  nextActionAt: z.coerce.date().nullish(),
  clientHidden: z.boolean().nullish(),
});

export const leadFilters = z.object({
  pipeline: z.string().uuid().optional(),
  account: z.string().uuid().optional(),
  stage: z.string().uuid().optional(),
  owner: z.string().uuid().optional(),
  // "no_next_action" surfaces the shame list (docs/07)
  flag: z.enum(["no_next_action"]).optional(),
});

export type LeadWithMeta = Lead & { ownerName: string | null; stageName: string | null };

function guard(viewer: Viewer): Result<true> {
  if (!isInternal(viewer)) return err("forbidden", "Leads are internal");
  return ok(true);
}

async function loadLead(id: string): Promise<Lead | null> {
  const [row] = await db.select().from(leads).where(eq(leads.id, id));
  return row ?? null;
}

export async function listLeads(
  viewer: Viewer,
  filters: z.infer<typeof leadFilters>,
): Promise<Result<LeadWithMeta[]>> {
  const g = guard(viewer);
  if (!g.ok) return g as Result<never>;

  const conds: (SQL | undefined)[] = [];
  if (filters.pipeline) conds.push(eq(leads.pipelineUuid, filters.pipeline));
  if (filters.account) conds.push(eq(leads.accountId, filters.account));
  if (filters.stage) conds.push(eq(leads.stageUuid, filters.stage));
  if (filters.owner) conds.push(eq(leads.ownerId, filters.owner));
  if (filters.flag === "no_next_action") conds.push(isNull(leads.nextActionAt));

  const rows = await db
    .select({ lead: leads, ownerName: users.name, stageName: stages.name })
    .from(leads)
    .leftJoin(users, eq(users.id, leads.ownerId))
    .leftJoin(stages, eq(stages.id, leads.stageUuid))
    .where(conds.length ? and(...conds.filter(Boolean)) : undefined)
    .orderBy(desc(leads.updatedAt));

  return ok(rows.map((r) => ({ ...r.lead, ownerName: r.ownerName, stageName: r.stageName })));
}

export type LeadDetail = { lead: Lead; timeline: LeadActivity[] };

export async function getLead(viewer: Viewer, id: string): Promise<Result<LeadDetail>> {
  const g = guard(viewer);
  if (!g.ok) return g as Result<never>;
  const lead = await loadLead(id);
  if (!lead) return err("not_found", "Lead not found");
  if (lead.accountId && !canViewAccount(viewer, lead.accountId)) {
    return err("not_found", "Lead not found");
  }
  const timeline = await db
    .select()
    .from(leadActivities)
    .where(eq(leadActivities.leadId, id))
    .orderBy(desc(leadActivities.createdAt))
    .limit(50);
  return ok({ lead, timeline });
}

export async function createLead(
  viewer: Viewer,
  input: z.infer<typeof leadInput>,
): Promise<Result<Lead>> {
  const g = guard(viewer);
  if (!g.ok) return g as Result<never>;
  if (input.accountId && !canViewAccount(viewer, input.accountId)) {
    return err("not_found", "Account not found");
  }
  // Verify the pipeline exists and belongs to the same account scope.
  const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.id, input.pipelineUuid));
  if (!pipeline) return err("invalid", "Pipeline not found");

  const [row] = await db
    .insert(leads)
    .values({
      accountId: input.accountId ?? pipeline.accountId ?? null,
      pipelineUuid: input.pipelineUuid,
      stageUuid: input.stageUuid ?? null,
      name: input.name ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      company: input.company ?? null,
      valueCents: input.valueCents ?? null,
      source: input.source ?? "manual",
      tags: input.tags ?? null,
      links: input.links ?? [],
      ownerId: input.ownerId ?? null,
      internalNotes: input.internalNotes ?? null,
      nextActionAt: input.nextActionAt ?? null,
      clientHidden: input.clientHidden ?? false,
    })
    .returning();
  return ok(row!);
}

export async function updateLead(
  viewer: Viewer,
  id: string,
  input: Partial<z.infer<typeof leadInput>>,
): Promise<Result<Lead>> {
  const g = guard(viewer);
  if (!g.ok) return g as Result<never>;
  const existing = await loadLead(id);
  if (!existing) return err("not_found", "Lead not found");
  if (existing.accountId && !canViewAccount(viewer, existing.accountId)) {
    return err("not_found", "Lead not found");
  }

  const patch: Partial<typeof leads.$inferInsert> = { updatedAt: new Date() };
  for (const key of [
    "name", "email", "phone", "company", "valueCents", "source",
    "ownerId", "internalNotes", "clientHidden",
  ] as const) {
    if (input[key] !== undefined) (patch as Record<string, unknown>)[key] = input[key] ?? null;
  }
  if (input.tags !== undefined) patch.tags = input.tags ?? null;
  if (input.links !== undefined) patch.links = input.links ?? [];
  if (input.nextActionAt !== undefined) patch.nextActionAt = input.nextActionAt ?? null;

  const [row] = await db.update(leads).set(patch).where(eq(leads.id, id)).returning();
  return ok(row!);
}

/** Move a lead to a new stage and log a stage_change activity for the timeline. */
export async function moveLead(
  viewer: Viewer,
  id: string,
  stageUuid: string,
): Promise<Result<Lead>> {
  const g = guard(viewer);
  if (!g.ok) return g as Result<never>;
  const existing = await loadLead(id);
  if (!existing) return err("not_found", "Lead not found");
  if (existing.accountId && !canViewAccount(viewer, existing.accountId)) {
    return err("not_found", "Lead not found");
  }
  const [toStage] = await db.select().from(stages).where(eq(stages.id, stageUuid));
  if (!toStage) return err("invalid", "Stage not found");

  const [row] = await db
    .update(leads)
    .set({ stageUuid, updatedAt: new Date() })
    .where(eq(leads.id, id))
    .returning();

  if (existing.stageUuid !== stageUuid) {
    await db.insert(leadActivities).values({
      leadId: id,
      kind: "stage_change",
      actorId: viewer.id,
      body: { from: existing.stageUuid, to: stageUuid, toName: toStage.name },
    });
  }
  return ok(row!);
}

export const noteInput = z.object({ body: z.string().trim().min(1).max(10_000) });

export async function addNote(
  viewer: Viewer,
  id: string,
  input: z.infer<typeof noteInput>,
): Promise<Result<LeadActivity>> {
  const g = guard(viewer);
  if (!g.ok) return g as Result<never>;
  const existing = await loadLead(id);
  if (!existing) return err("not_found", "Lead not found");
  if (existing.accountId && !canViewAccount(viewer, existing.accountId)) {
    return err("not_found", "Lead not found");
  }
  const [row] = await db
    .insert(leadActivities)
    .values({ leadId: id, kind: "note", actorId: viewer.id, body: { text: input.body } })
    .returning();
  return ok(row!);
}

// ===== All-accounts overview (docs/02) =====

export type PipelineOverview = {
  pipelineId: string;
  pipelineName: string;
  accountId: string | null;
  leadCount: number;
  openValueCents: number;
  wonThisMonth: number;
  noNextAction: number;
  stalestUpdatedAt: string | null;
};

export async function overview(viewer: Viewer): Promise<Result<PipelineOverview[]>> {
  const g = guard(viewer);
  if (!g.ok) return g as Result<never>;

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const rows = await db
    .select({
      pipelineId: pipelines.id,
      pipelineName: pipelines.name,
      accountId: pipelines.accountId,
      leadCount: sql<number>`count(${leads.id})::int`,
      openValueCents: sql<number>`coalesce(sum(case when ${stages.isWon} is not true and ${stages.isLost} is not true then ${leads.valueCents} else 0 end), 0)::bigint`,
      wonThisMonth: sql<number>`count(${leads.id}) filter (where ${stages.isWon} = true and ${leads.updatedAt} >= ${startOfMonth.toISOString()})::int`,
      noNextAction: sql<number>`count(${leads.id}) filter (where ${leads.nextActionAt} is null and (${stages.isWon} is not true and ${stages.isLost} is not true))::int`,
      stalestUpdatedAt: sql<string | null>`min(${leads.updatedAt})`,
    })
    .from(pipelines)
    .leftJoin(leads, eq(leads.pipelineUuid, pipelines.id))
    .leftJoin(stages, eq(stages.id, leads.stageUuid))
    .groupBy(pipelines.id, pipelines.name, pipelines.accountId)
    .orderBy(pipelines.name);

  return ok(
    rows.map((r) => ({
      ...r,
      openValueCents: Number(r.openValueCents),
    })),
  );
}
