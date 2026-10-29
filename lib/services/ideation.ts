import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { canMutateAccount, canViewAccount, isInternal, type Viewer } from "@/lib/access";
import { anthropic, messageText } from "@/lib/ai/anthropic";
import { db } from "@/lib/db";
import {
  accounts,
  clientBrains,
  files,
  goals,
  ideaItems,
  ideaSessions,
  tasks,
  type Goal,
  type IdeaItem,
  type IdeaSession,
  type Task,
} from "@/lib/db/schema";
import { cleanDueDate, cleanGoalId, fillTemplate, groupItems, priorityScore, todayIn, type Alignment, type Horizon, type ItemKind } from "@/lib/ideation/rank";
import { getQueue } from "@/lib/queues";
import { err, ok, type Result } from "@/lib/result";
import { notify } from "@/lib/services/notifications";

// Ideation (docs/19): rambles → ranked goals and action items, judged against
// the business's active goals. Internal-only; clients get 404 everywhere.
// DECISION: model via IDEATION_MODEL defaulting to the current Sonnet, same
// reasoning as LEAD_SCORING_MODEL (sampling params omitted).
export const IDEATION_MODEL = process.env.IDEATION_MODEL ?? "claude-sonnet-5";

const MAX_RAMBLE_CHARS = 60_000;

// ---------- Guards ----------

function guard(viewer: Viewer, accountId: string, mutate = false): Result<true> {
  if (!isInternal(viewer) || !canViewAccount(viewer, accountId)) return err("not_found", "Not found");
  if (mutate && !canMutateAccount(viewer, accountId)) return err("forbidden", "Only the team can change this");
  return ok(true);
}

async function loadSession(viewer: Viewer, id: string, mutate = false): Promise<Result<IdeaSession>> {
  if (!isInternal(viewer)) return err("not_found", "Ramble not found");
  const [s] = await db.select().from(ideaSessions).where(and(eq(ideaSessions.id, id), isNull(ideaSessions.deletedAt)));
  if (!s) return err("not_found", "Ramble not found");
  const g = guard(viewer, s.accountId, mutate);
  return g.ok ? ok(s) : (g as Result<never>);
}

// ---------- Goals ----------

export const GOAL_HORIZONS = ["quarter", "year", "long_term"] as const;
export const GOAL_STATUSES = ["active", "achieved", "dropped"] as const;

export const goalInput = z.object({
  accountId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  detail: z.string().trim().max(2000).nullish(),
  horizon: z.enum(GOAL_HORIZONS).default("quarter"),
  metric: z.string().trim().max(200).nullish(),
  target: z.string().trim().max(200).nullish(),
  dueOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
});
export const goalPatch = goalInput.omit({ accountId: true }).partial().extend({ status: z.enum(GOAL_STATUSES).optional(), position: z.number().int().optional() });

export async function listGoals(viewer: Viewer, accountId: string): Promise<Result<Goal[]>> {
  const g = guard(viewer, accountId);
  if (!g.ok) return g as Result<never>;
  return ok(
    await db
      .select()
      .from(goals)
      .where(and(eq(goals.accountId, accountId), isNull(goals.deletedAt)))
      .orderBy(asc(goals.position), asc(goals.createdAt)),
  );
}

export async function createGoal(viewer: Viewer, input: z.infer<typeof goalInput>): Promise<Result<Goal>> {
  const g = guard(viewer, input.accountId, true);
  if (!g.ok) return g as Result<never>;
  const [row] = await db
    .insert(goals)
    .values({
      accountId: input.accountId,
      title: input.title,
      detail: input.detail ?? null,
      horizon: input.horizon,
      metric: input.metric ?? null,
      target: input.target ?? null,
      dueOn: input.dueOn ?? null,
      position: Date.now() % 2_000_000_000,
      createdBy: viewer.id,
    })
    .returning();
  return ok(row!);
}

async function loadGoal(viewer: Viewer, id: string): Promise<Result<Goal>> {
  if (!isInternal(viewer)) return err("not_found", "Goal not found");
  const [goal] = await db.select().from(goals).where(and(eq(goals.id, id), isNull(goals.deletedAt)));
  if (!goal) return err("not_found", "Goal not found");
  const g = guard(viewer, goal.accountId, true);
  return g.ok ? ok(goal) : (g as Result<never>);
}

export async function updateGoal(viewer: Viewer, id: string, input: z.infer<typeof goalPatch>): Promise<Result<Goal>> {
  const loaded = await loadGoal(viewer, id);
  if (!loaded.ok) return loaded;
  const [row] = await db.update(goals).set({ ...input, updatedAt: new Date() }).where(eq(goals.id, id)).returning();
  return ok(row!);
}

export async function deleteGoal(viewer: Viewer, id: string): Promise<Result<Goal>> {
  const loaded = await loadGoal(viewer, id);
  if (!loaded.ok) return loaded;
  const [row] = await db.update(goals).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(goals.id, id)).returning();
  return ok(row!);
}

// ---------- Sessions ----------

export const sessionInput = z
  .object({
    accountId: z.string().uuid(),
    text: z.string().trim().min(1).max(MAX_RAMBLE_CHARS).optional(),
    audioFileId: z.string().uuid().optional(),
  })
  .refine((v) => Boolean(v.text) !== Boolean(v.audioFileId), "Send either text or a recording, not both.");

export async function createSession(viewer: Viewer, input: z.infer<typeof sessionInput>): Promise<Result<IdeaSession>> {
  const g = guard(viewer, input.accountId, true);
  if (!g.ok) return g as Result<never>;

  if (input.audioFileId) {
    const [file] = await db.select().from(files).where(eq(files.id, input.audioFileId));
    if (!file || file.accountId !== input.accountId) return err("not_found", "Recording not found");
    const [row] = await db
      .insert(ideaSessions)
      .values({ accountId: input.accountId, source: "voice", audioFileId: file.id, status: "transcribing", createdBy: viewer.id })
      .returning();
    await getQueue("transcribe").add("transcribe-idea", { sessionId: row!.id }, { jobId: `idea-tx-${row!.id}` });
    return ok(row!);
  }

  if (!process.env.ANTHROPIC_API_KEY) return err("invalid", "Ideation needs ANTHROPIC_API_KEY on the server.");
  const [row] = await db
    .insert(ideaSessions)
    .values({ accountId: input.accountId, source: "text", transcript: input.text!, status: "thinking", createdBy: viewer.id })
    .returning();
  await getQueue("ai").add("ideation", { sessionId: row!.id }, { jobId: `idea-${row!.id}` });
  return ok(row!);
}

export async function retrySession(viewer: Viewer, id: string): Promise<Result<IdeaSession>> {
  const loaded = await loadSession(viewer, id, true);
  if (!loaded.ok) return loaded;
  const s = loaded.value;
  if (s.status !== "failed") return err("conflict", "Only a failed ramble can be retried.");
  const next = s.transcript ? "thinking" : "transcribing";
  const [row] = await db.update(ideaSessions).set({ status: next, error: null }).where(eq(ideaSessions.id, id)).returning();
  if (next === "thinking") await getQueue("ai").add("ideation", { sessionId: id }, { jobId: `idea-${id}-${Date.now()}` });
  else await getQueue("transcribe").add("transcribe-idea", { sessionId: id }, { jobId: `idea-tx-${id}-${Date.now()}` });
  return ok(row!);
}

export async function deleteSession(viewer: Viewer, id: string): Promise<Result<IdeaSession>> {
  const loaded = await loadSession(viewer, id, true);
  if (!loaded.ok) return loaded;
  const [row] = await db.update(ideaSessions).set({ deletedAt: new Date() }).where(eq(ideaSessions.id, id)).returning();
  return ok(row!);
}

export async function listSessions(viewer: Viewer, accountId: string) {
  const g = guard(viewer, accountId);
  if (!g.ok) return g as Result<never>;
  const rows = await db
    .select({
      id: ideaSessions.id,
      title: ideaSessions.title,
      source: ideaSessions.source,
      status: ideaSessions.status,
      summary: ideaSessions.summary,
      themes: ideaSessions.themes,
      createdAt: ideaSessions.createdAt,
    })
    .from(ideaSessions)
    .where(and(eq(ideaSessions.accountId, accountId), isNull(ideaSessions.deletedAt)))
    .orderBy(desc(ideaSessions.createdAt))
    .limit(50);
  return ok(rows);
}

export type RankedItem = IdeaItem & { score: number; goalTitle: string | null };

export async function getSession(viewer: Viewer, id: string) {
  const loaded = await loadSession(viewer, id);
  if (!loaded.ok) return loaded;
  const items = await db.select().from(ideaItems).where(eq(ideaItems.sessionId, id)).orderBy(asc(ideaItems.position));
  const goalIds = [...new Set(items.map((i) => i.goalId).filter(Boolean))] as string[];
  const goalRows = goalIds.length ? await db.select({ id: goals.id, title: goals.title }).from(goals).where(inArray(goals.id, goalIds)) : [];
  const ranked: RankedItem[] = items.map((i) => ({
    ...i,
    score: priorityScore({ kind: i.kind as ItemKind, alignment: i.alignment as Alignment, impact: i.impact, effort: i.effort, horizon: (i.horizon as Horizon) ?? null }),
    goalTitle: goalRows.find((gr) => gr.id === i.goalId)?.title ?? null,
  }));
  const typed = ranked.map((r) => ({ ...r, kind: r.kind as ItemKind, alignment: r.alignment as Alignment, horizon: (r.horizon as Horizon) ?? null }));
  return ok({ session: loaded.value, groups: groupItems(typed) });
}

// ---------- The ideation job ----------

const outputItem = z.object({
  kind: z.enum(["action", "goal", "idea", "question", "risk"]),
  title: z.string().min(1).max(300),
  detail: z.string().max(1000).nullish(),
  goal_id: z.string().max(80).nullish(),
  alignment: z.enum(["advances", "new_direction", "off_strategy"]),
  alignment_note: z.string().max(500).nullish(),
  impact: z.number().nullish(),
  effort: z.number().nullish(),
  horizon: z.enum(["now", "this_week", "this_month", "this_quarter", "later"]).nullish(),
  suggested_due: z.string().max(20).nullish(),
  quote: z.string().max(400).nullish(),
  goal_metric: z.string().max(200).nullish(),
  goal_target: z.string().max(200).nullish(),
});
export const ideationOutput = z.object({
  title: z.string().max(120).nullish(),
  summary: z.string().max(2000),
  themes: z.array(z.string().max(60)).max(8).default([]),
  items: z.array(outputItem).max(40),
});
export type IdeationOutput = z.infer<typeof ideationOutput>;

let cached: { system: string; template: string } | null = null;
async function promptParts() {
  if (cached) return cached;
  const md = await readFile(path.join(process.cwd(), "prompts", "ideation.md"), "utf8");
  const system = md.match(/## System prompt\s*\n+```\n([\s\S]*?)\n```/)?.[1];
  const template = md.match(/## Runtime context \(user message\)\s*\n+```\n([\s\S]*?)\n```/)?.[1];
  if (!system || !template) throw new Error("Could not parse prompts/ideation.md");
  cached = { system: system.trim(), template: template.trim() };
  return cached;
}

function brainText(b: typeof clientBrains.$inferSelect | undefined): string {
  if (!b) return "(none on file)";
  const lines = [
    b.offer && `Offer: ${b.offer}`,
    b.icp && `Ideal customer: ${b.icp}`,
    b.positioning && `Positioning: ${b.positioning}`,
    b.goalsCurrentQuarter && `This quarter: ${b.goalsCurrentQuarter}`,
    Array.isArray(b.complianceNos) && b.complianceNos.length ? `Never: ${(b.complianceNos as string[]).join("; ")}` : null,
  ].filter(Boolean);
  return lines.length ? lines.join("\n") : "(none on file)";
}

/** Worker (ai queue): ramble + goals + Brain → items. One retry on bad JSON, then fail loudly (rule 6). */
export async function runIdeation(sessionId: string, finalAttempt = true) {
  const [s] = await db.select().from(ideaSessions).where(eq(ideaSessions.id, sessionId));
  if (!s) throw new Error(`Idea session ${sessionId} not found`);
  if (s.status !== "thinking") return { sessionId, skipped: s.status };
  if (!s.transcript?.trim()) return failSession(s, "The recording came back empty. Try again closer to the mic.");

  const [account] = await db.select().from(accounts).where(eq(accounts.id, s.accountId));
  const [brain] = await db.select().from(clientBrains).where(eq(clientBrains.accountId, s.accountId));
  const active = await db
    .select()
    .from(goals)
    .where(and(eq(goals.accountId, s.accountId), eq(goals.status, "active"), isNull(goals.deletedAt)))
    .orderBy(asc(goals.position));
  const today = todayIn(account?.timezone ?? "America/Chicago");

  const { system, template } = await promptParts();
  const user = fillTemplate(template, {
    today: today.iso,
    weekday: today.weekday,
    account_name: account?.name ?? "the business",
    goals: active.length
      ? active.map((g) => `- [${g.id}] ${g.title}${g.metric ? ` · metric: ${g.metric}` : ""}${g.target ? ` · target: ${g.target}` : ""}${g.dueOn ? ` · by ${g.dueOn}` : ""} (${g.horizon})`).join("\n")
      : "(no active goals yet — mark everything worthwhile as new_direction and propose goals)",
    brain: brainText(brain),
    source: s.source === "voice" ? "transcribed from voice, expect errors" : "typed",
    ramble: s.transcript.slice(0, MAX_RAMBLE_CHARS),
  });

  const client = anthropic();
  async function attempt(extra?: string): Promise<IdeationOutput> {
    const msg = await client.messages.create({
      model: IDEATION_MODEL,
      max_tokens: 8000,
      system,
      messages: [{ role: "user", content: extra ? `${user}\n\n${extra}` : user }],
    });
    const text = messageText(msg).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    return ideationOutput.parse(JSON.parse(text));
  }

  let out: IdeationOutput;
  try {
    try {
      out = await attempt();
    } catch (first) {
      if (!(first instanceof SyntaxError) && !(first instanceof Error && first.name === "ZodError")) throw first;
      out = await attempt(`Your previous reply could not be used (${first.message.slice(0, 300)}). Return ONLY the JSON object described.`);
    }
  } catch (e) {
    const permanent = e instanceof SyntaxError || (e instanceof Error && e.name === "ZodError");
    if (permanent) await failSession(s, "Claude's answer couldn't be read. Retry, or shorten the ramble.");
    else if (finalAttempt) await failSession(s, "Couldn't reach Claude. Retry in a few minutes.");
    throw e; // job_runs records it; transient errors retry via BullMQ
  }

  const activeIds = active.map((g) => g.id);
  const rows = out.items.map((i, idx) => ({
    sessionId: s.id,
    accountId: s.accountId,
    kind: i.kind,
    title: i.title.trim(),
    detail: i.detail?.trim() || null,
    goalId: cleanGoalId(i.goal_id, activeIds),
    alignment: i.alignment,
    alignmentNote: i.alignment_note?.trim() || null,
    impact: i.impact == null ? null : Math.min(5, Math.max(1, Math.round(i.impact))),
    effort: i.effort == null ? null : Math.min(5, Math.max(1, Math.round(i.effort))),
    horizon: i.horizon ?? null,
    suggestedDue: cleanDueDate(i.suggested_due, today.iso),
    quote: i.quote?.trim() || null,
    meta: i.kind === "goal" ? { metric: i.goal_metric ?? null, target: i.goal_target ?? null } : {},
    position: idx,
  }));

  await db.delete(ideaItems).where(and(eq(ideaItems.sessionId, s.id), eq(ideaItems.status, "proposed"))); // a retry replaces untouched proposals
  if (rows.length) await db.insert(ideaItems).values(rows);
  await db
    .update(ideaSessions)
    .set({ status: "ready", title: out.title?.trim() || null, summary: out.summary, themes: out.themes, finishedAt: new Date(), error: null })
    .where(eq(ideaSessions.id, s.id));

  if (s.createdBy) {
    const actions = rows.filter((r) => r.kind === "action").length;
    await notify([s.createdBy], {
      kind: "ideation_ready",
      body: { sessionId: s.id, text: `${out.title ?? "Your ramble"}: ${actions} action${actions === 1 ? "" : "s"} to review`, href: `/ideas?session=${s.id}` },
    });
  }
  return { sessionId, items: rows.length };
}

async function failSession(s: IdeaSession, message: string) {
  await db.update(ideaSessions).set({ status: "failed", error: message, finishedAt: new Date() }).where(eq(ideaSessions.id, s.id));
  if (s.createdBy) await notify([s.createdBy], { kind: "ideation_failed", body: { sessionId: s.id, text: message, href: `/ideas?session=${s.id}` } });
  return { sessionId: s.id, failed: message };
}

/** Called by the transcribe worker once the voice ramble is text. */
export async function transcriptReady(sessionId: string, transcript: string) {
  const [s] = await db.select().from(ideaSessions).where(eq(ideaSessions.id, sessionId));
  if (!s || s.status !== "transcribing") return;
  if (!transcript.trim()) {
    await failSession(s, "The recording came back empty. Try again closer to the mic.");
    return;
  }
  await db.update(ideaSessions).set({ transcript, status: "thinking" }).where(eq(ideaSessions.id, sessionId));
  await getQueue("ai").add("ideation", { sessionId }, { jobId: `idea-${sessionId}` });
}

// ---------- Decisions ----------

export const decideItemInput = z.object({
  decision: z.enum(["accept", "dismiss", "park"]),
  title: z.string().trim().min(1).max(300).optional(), // edit before accepting
  dueOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(), // override the suggested due date
});

export type DecideResult = { item: IdeaItem; task: Task | null; goal: Goal | null };

export async function decideItem(viewer: Viewer, itemId: string, input: z.infer<typeof decideItemInput>): Promise<Result<DecideResult>> {
  if (!isInternal(viewer)) return err("not_found", "Item not found");
  const [item] = await db.select().from(ideaItems).where(eq(ideaItems.id, itemId));
  if (!item) return err("not_found", "Item not found");
  const loaded = await loadSession(viewer, item.sessionId, true);
  if (!loaded.ok) return loaded as Result<never>;
  if (item.status === "accepted") return err("conflict", "Already accepted.");

  const title = input.title ?? item.title;
  const now = new Date();
  let task: Task | null = null;
  let goal: Goal | null = null;

  if (input.decision === "accept" && item.kind === "action") {
    const due = input.dueOn === undefined ? item.suggestedDue : input.dueOn;
    const score = priorityScore({ kind: "action", alignment: item.alignment as Alignment, impact: item.impact, effort: item.effort, horizon: (item.horizon as Horizon) ?? null });
    const description = [item.detail, item.alignmentNote && `Why: ${item.alignmentNote}`, item.quote && `You said: "${item.quote}"`, `From ramble ${loaded.value.title ?? ""}`.trim()]
      .filter(Boolean)
      .join("\n\n");
    [task] = await db
      .insert(tasks)
      .values({
        accountId: item.accountId,
        title,
        description,
        status: "todo",
        priority: score >= 4 ? "high" : score >= 2 ? "normal" : "low",
        assigneeId: viewer.id,
        // due dates are dates; land them late afternoon Central so they sort as end-of-day
        dueAt: due ? new Date(`${due}T22:00:00Z`) : null,
        source: "ideation",
        sourceId: item.id,
      })
      .returning();
  } else if (input.decision === "accept" && item.kind === "goal") {
    const meta = (item.meta ?? {}) as { metric?: string | null; target?: string | null };
    [goal] = await db
      .insert(goals)
      .values({
        accountId: item.accountId,
        title,
        detail: item.detail,
        horizon: item.horizon === "later" ? "long_term" : item.horizon === "this_quarter" || item.horizon === "this_month" ? "quarter" : "year",
        metric: meta.metric ?? null,
        target: meta.target ?? null,
        dueOn: input.dueOn ?? null,
        position: Date.now() % 2_000_000_000,
        createdBy: viewer.id,
      })
      .returning();
  }

  // Accepting an idea/question/risk just keeps it (parked) — there's nothing to create.
  const status = input.decision === "dismiss" ? "dismissed" : input.decision === "park" || (!task && !goal) ? "parked" : "accepted";
  const [row] = await db
    .update(ideaItems)
    .set({ status, title, taskId: task?.id ?? null, createdGoalId: goal?.id ?? null, decidedBy: viewer.id, decidedAt: now })
    .where(eq(ideaItems.id, item.id))
    .returning();
  return ok({ item: row!, task, goal });
}

/** "Accept all actions" — every proposed, on-strategy action in the session becomes a task. */
export async function acceptAllActions(viewer: Viewer, sessionId: string): Promise<Result<{ accepted: number }>> {
  const loaded = await loadSession(viewer, sessionId, true);
  if (!loaded.ok) return loaded as Result<never>;
  const pending = await db
    .select({ id: ideaItems.id, alignment: ideaItems.alignment })
    .from(ideaItems)
    .where(and(eq(ideaItems.sessionId, sessionId), eq(ideaItems.kind, "action"), eq(ideaItems.status, "proposed")));
  let accepted = 0;
  for (const p of pending) {
    if (p.alignment === "off_strategy") continue; // flags stay a deliberate choice
    const r = await decideItem(viewer, p.id, { decision: "accept" });
    if (r.ok) accepted++;
  }
  return ok({ accepted });
}
