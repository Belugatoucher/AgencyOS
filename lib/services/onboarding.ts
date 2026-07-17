import { randomBytes } from "node:crypto";
import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { canMutateAccount, canViewAccount, isInternal, type Viewer } from "@/lib/access";
import { db } from "@/lib/db";
import {
  accounts,
  brainSuggestions,
  contentSlots,
  intakeForms,
  meetings,
  memberships,
  projectTemplates,
  researchDocs,
  tasks,
  users,
  type IntakeForm,
  type ProjectTemplate,
} from "@/lib/db/schema";
import { err, ok, type Result } from "@/lib/result";
import { parseRRule } from "@/lib/rrule";
import { brainInput, updateBrain } from "@/lib/services/brain";
import { notify } from "@/lib/services/notifications";

// Onboarding (docs/10): intake → member review → Brain v1 + kickoff.
// The public form is token-only (no login) — audit item 6 hardening lives in
// the route (rate limit, body cap, identical errors) and here (strict Zod,
// size caps, token is a 192-bit CSPRNG value per audit item 1).

// Fixed sections, 1:1 with Client Brain fields (docs/10). Everything optional:
// clients never finish in one sitting, partial saves are the norm.
export const intakeSections = z
  .object({
    offer: z.string().max(4000),
    icp: z.string().max(4000),
    goals: z.string().max(4000),
    voice: z
      .object({
        admired_brands: z.string().max(2000),
        sample_copy: z.string().max(4000),
        do: z.string().max(2000),
        dont: z.string().max(2000),
      })
      .partial(),
    objections: z.string().max(4000), // free text, one per line
    proof_points: z.string().max(4000),
    compliance_nos: z.string().max(4000),
    competitors: z.string().max(2000), // one per line
    access_checklist: z.string().max(2000), // "still need: ad account, IG login…"
  })
  .partial()
  .strict();
export type IntakeSections = z.infer<typeof intakeSections>;

/** Internal users holding a membership on the account (notification targets). */
export async function accountInternalUserIds(accountId: string): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.accountId, accountId), ne(users.role, "client")));
  return rows.map((r) => r.id);
}

function internalOnly(viewer: Viewer, accountId: string): Result<true> {
  if (!isInternal(viewer)) return err("forbidden", "Onboarding is internal");
  if (!canViewAccount(viewer, accountId)) return err("not_found", "Account not found");
  if (!canMutateAccount(viewer, accountId)) return err("forbidden", "Only the team can manage onboarding");
  return ok(true);
}

export async function createIntake(viewer: Viewer, accountId: string): Promise<Result<IntakeForm>> {
  const g = internalOnly(viewer, accountId);
  if (!g.ok) return g as Result<never>;
  const token = randomBytes(24).toString("base64url"); // 192-bit (audit item 1)
  const [row] = await db
    .insert(intakeForms)
    .values({
      accountId,
      token,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days (docs/10)
    })
    .returning();
  return ok(row!);
}

export async function listIntakes(viewer: Viewer, accountId: string): Promise<Result<IntakeForm[]>> {
  const g = internalOnly(viewer, accountId);
  if (!g.ok) return g as Result<never>;
  return ok(
    await db
      .select()
      .from(intakeForms)
      .where(eq(intakeForms.accountId, accountId))
      .orderBy(desc(intakeForms.createdAt)),
  );
}

// ---- Public (token-gated) ----

type PublicIntake = { accountName: string; sections: IntakeSections; status: string };

async function liveFormByToken(token: string) {
  if (token.length < 16 || token.length > 64) return null;
  const [form] = await db.select().from(intakeForms).where(eq(intakeForms.token, token));
  if (!form) return null;
  if (form.expiresAt < new Date()) return null;
  if (form.status === "committed") return null;
  return form;
}

export async function getPublicIntake(token: string): Promise<Result<PublicIntake>> {
  const form = await liveFormByToken(token);
  if (!form) return err("not_found", "This form is not available");
  const [account] = await db.select().from(accounts).where(eq(accounts.id, form.accountId));
  return ok({
    accountName: account?.name ?? "your agency",
    sections: (form.sections ?? {}) as IntakeSections,
    status: form.status,
  });
}

/**
 * Partial save or submit. Saves merge (clients return across sittings);
 * submit freezes the answers and drops a review suggestion for the team.
 */
export async function savePublicIntake(
  token: string,
  sections: IntakeSections,
  submit: boolean,
): Promise<Result<{ status: string }>> {
  const form = await liveFormByToken(token);
  if (!form) return err("not_found", "This form is not available");
  if (form.status === "submitted" && !submit) return err("conflict", "Already submitted");

  const merged = { ...(form.sections as IntakeSections), ...sections };
  const status = submit ? "submitted" : "in_progress";
  await db.update(intakeForms).set({ sections: merged, status }).where(eq(intakeForms.id, form.id));

  if (submit) {
    // The batch lands as ONE pending suggestion (docs/10: nothing writes to
    // the Brain without member acceptance). The commit screen is the accept
    // path; decideSuggestion refuses this field so it can't be applied blind.
    await db.insert(brainSuggestions).values({
      accountId: form.accountId,
      field: "intake",
      proposed: merged,
      source: "intake",
      sourceId: form.id,
    });
    const team = await accountInternalUserIds(form.accountId);
    void notify(team, {
      kind: "intake_submitted",
      body: { accountId: form.accountId, intakeId: form.id },
      slackText: `📥 Client intake submitted — review & commit to write Brain v1`,
    });
  }
  return ok({ status });
}

// ---- Review & commit (docs/10) ----

export const commitInput = z.object({
  brain: brainInput, // the member-reviewed/edited Brain payload
  competitors: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
  gapTasks: z.array(z.string().trim().min(1).max(300)).max(30).default([]), // access checklist gaps
  templateId: z.string().uuid().nullish(),
});

export type CommitSummary = {
  brainVersion: number;
  researchStubs: number;
  gapTasks: number;
  kickoffTasks: number;
  kickoffSlots: number;
};

export async function commitIntake(
  viewer: Viewer,
  intakeId: string,
  input: z.infer<typeof commitInput>,
): Promise<Result<CommitSummary>> {
  const [form] = await db.select().from(intakeForms).where(eq(intakeForms.id, intakeId));
  if (!form) return err("not_found", "Intake not found");
  const g = internalOnly(viewer, form.accountId);
  if (!g.ok) return g as Result<never>;
  if (form.status === "committed") return err("conflict", "Already committed");

  // Brain v1 — through updateBrain so the version snapshot machinery applies.
  const brain = await updateBrain(viewer, form.accountId, input.brain);
  if (!brain.ok) return brain as Result<never>;

  // Competitor list seeds research stubs (embedded once someone pastes/uploads
  // the actual research — status "stub" keeps them out of retrieval).
  for (const name of input.competitors) {
    await db.insert(researchDocs).values({
      accountId: form.accountId,
      kind: "competitor",
      title: name,
      status: "stub",
    });
  }

  // Access gaps become tasks assigned to the committing member (the AM).
  for (const title of input.gapTasks) {
    await db.insert(tasks).values({
      accountId: form.accountId,
      title,
      assigneeId: viewer.id,
      source: "manual",
    });
  }

  let kickoffTasks = 0;
  let kickoffSlots = 0;
  if (input.templateId) {
    const spawned = await spawnKickoff(viewer, form.accountId, input.templateId);
    if (!spawned.ok) return spawned as Result<never>;
    kickoffTasks = spawned.value.tasks;
    kickoffSlots = spawned.value.slots;
  }

  await db.update(intakeForms).set({ status: "committed" }).where(eq(intakeForms.id, form.id));
  await db
    .update(brainSuggestions)
    .set({ status: "accepted" })
    .where(eq(brainSuggestions.sourceId, form.id));

  return ok({
    brainVersion: brain.value.version,
    researchStubs: input.competitors.length,
    gapTasks: input.gapTasks.length,
    kickoffTasks,
    kickoffSlots,
  });
}

// ---- Project templates + kickoff spawn (docs/10) ----

export const templateInput = z.object({
  name: z.string().trim().min(1).max(200),
  taskSet: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(300),
        description: z.string().max(2000).nullish(),
        offsetDays: z.number().int().min(0).max(365).default(0),
        clientVisible: z.boolean().default(false),
      }),
    )
    .max(50)
    .default([]),
  defaultSlots: z
    .array(z.object({ rrule: z.string().min(1).max(500), channels: z.array(z.string().max(30)).min(1).max(6) }))
    .max(10)
    .default([]),
});

export async function listTemplates(viewer: Viewer): Promise<Result<ProjectTemplate[]>> {
  if (!isInternal(viewer)) return err("forbidden", "Templates are internal");
  return ok(await db.select().from(projectTemplates).orderBy(projectTemplates.name));
}

export async function createTemplate(
  viewer: Viewer,
  input: z.infer<typeof templateInput>,
): Promise<Result<ProjectTemplate>> {
  if (!isInternal(viewer)) return err("forbidden", "Templates are internal");
  for (const slot of input.defaultSlots) {
    if (!parseRRule(slot.rrule)) return err("invalid", `Invalid RRULE: ${slot.rrule}`);
  }
  const [row] = await db
    .insert(projectTemplates)
    .values({ name: input.name, taskSet: input.taskSet, defaultSlots: input.defaultSlots })
    .returning();
  return ok(row!);
}

/** Spawn the template's kickoff set: tasks, content slots, a kickoff meeting. */
export async function spawnKickoff(
  viewer: Viewer,
  accountId: string,
  templateId: string,
): Promise<Result<{ tasks: number; slots: number; meetingId: string }>> {
  const g = internalOnly(viewer, accountId);
  if (!g.ok) return g as Result<never>;
  const [template] = await db.select().from(projectTemplates).where(eq(projectTemplates.id, templateId));
  if (!template) return err("not_found", "Template not found");

  const taskSet = (template.taskSet ?? []) as {
    title: string;
    description?: string | null;
    offsetDays?: number;
    clientVisible?: boolean;
  }[];
  for (const t of taskSet) {
    await db.insert(tasks).values({
      accountId,
      title: t.title,
      description: t.description ?? null,
      assigneeId: viewer.id,
      dueAt: new Date(Date.now() + (t.offsetDays ?? 0) * 24 * 60 * 60 * 1000),
      clientVisible: t.clientVisible ?? false,
      source: "manual",
    });
  }

  const slotSet = (template.defaultSlots ?? []) as { rrule: string; channels: string[] }[];
  for (const s of slotSet) {
    await db.insert(contentSlots).values({ accountId, rrule: s.rrule, channels: s.channels, label: "kickoff" });
  }

  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  const [meeting] = await db
    .insert(meetings)
    .values({
      accountId,
      title: `Kickoff — ${account?.name ?? "new client"}`,
      occurredAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    })
    .returning();

  return ok({ tasks: taskSet.length, slots: slotSet.length, meetingId: meeting!.id });
}
