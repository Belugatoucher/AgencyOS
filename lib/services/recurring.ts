import { and, eq, lte } from "drizzle-orm";
import { z } from "zod";
import { isInternal, type Viewer } from "@/lib/access";
import { db } from "@/lib/db";
import { recurringRules, tasks } from "@/lib/db/schema";
import { err, ok, type Result } from "@/lib/result";
import { nextOccurrence, parseRRule } from "@/lib/rrule";

// Template for the task each occurrence spawns. Kept small and validated so a
// malformed rule can't inject arbitrary columns (audit item 8 spirit).
const templateSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(20_000).optional(),
  accountId: z.string().uuid().nullish(),
  projectId: z.string().uuid().nullish(),
  assigneeId: z.string().uuid().nullish(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  estimateMinutes: z.number().int().positive().max(100_000).nullish(),
  clientVisible: z.boolean().default(false),
});

export const recurringRuleInput = z.object({
  rrule: z.string().trim().min(1).max(500),
  taskTemplate: templateSchema,
  // when the first occurrence should fire; defaults to now
  startAt: z.coerce.date().optional(),
});

export async function createRecurringRule(
  viewer: Viewer,
  input: z.infer<typeof recurringRuleInput>,
): Promise<Result<typeof recurringRules.$inferSelect>> {
  if (!isInternal(viewer)) return err("forbidden", "Only the team can create recurring rules");
  const start = input.startAt ?? new Date();
  // Validate the RRULE parses and yields a real cadence; the first fire is the
  // requested start time itself (nextOccurrence only advances after each spawn).
  if (!parseRRule(input.rrule) || !nextOccurrence(input.rrule, start)) {
    return err("invalid", "RRULE is invalid or produces no occurrences");
  }
  const [row] = await db
    .insert(recurringRules)
    .values({ rrule: input.rrule, taskTemplate: input.taskTemplate, nextRunAt: start })
    .returning();
  return ok(row!);
}

export async function listRecurringRules(
  viewer: Viewer,
): Promise<Result<(typeof recurringRules.$inferSelect)[]>> {
  if (!isInternal(viewer)) return err("forbidden", "Only the team can view recurring rules");
  return ok(await db.select().from(recurringRules));
}

/**
 * Spawn tasks for every active rule whose next_run_at has passed, then advance
 * next_run_at to the following occurrence. Idempotent-ish: driven by the clock,
 * so running it twice in the same minute won't double-spawn (the second pass
 * sees the advanced next_run_at). Called by the recurring worker job.
 */
export async function runDueRecurringRules(now = new Date()): Promise<{ spawned: number }> {
  const due = await db
    .select()
    .from(recurringRules)
    .where(and(eq(recurringRules.active, true), lte(recurringRules.nextRunAt, now)));

  let spawned = 0;
  for (const rule of due) {
    const tpl = templateSchema.parse(rule.taskTemplate);
    await db.insert(tasks).values({
      title: tpl.title,
      description: tpl.description ?? null,
      accountId: tpl.accountId ?? null,
      projectId: tpl.projectId ?? null,
      assigneeId: tpl.assigneeId ?? null,
      priority: tpl.priority,
      estimateMinutes: tpl.estimateMinutes ?? null,
      clientVisible: tpl.clientVisible,
      status: "todo",
      source: "recurring",
      sourceId: rule.id,
      dueAt: rule.nextRunAt,
    });
    spawned++;

    const next = nextOccurrence(rule.rrule, rule.nextRunAt);
    if (next) {
      await db.update(recurringRules).set({ nextRunAt: next }).where(eq(recurringRules.id, rule.id));
    } else {
      // no further occurrences — deactivate so it stops being picked up
      await db.update(recurringRules).set({ active: false }).where(eq(recurringRules.id, rule.id));
    }
  }
  return { spawned };
}
