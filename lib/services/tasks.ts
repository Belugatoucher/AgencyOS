import { and, asc, desc, eq, gte, inArray, isNotNull, lt, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { accessibleAccountIds, isInternal, type Viewer } from "@/lib/access";
import { db } from "@/lib/db";
import {
  taskChecklist,
  taskComments,
  tasks,
  users,
  type Task,
} from "@/lib/db/schema";
import { err, ok, type Result } from "@/lib/result";
import { notify } from "./notifications";

export const TASK_STATUSES = ["backlog", "todo", "in_progress", "in_review", "done"] as const;
export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

// Rank priority urgent→low for ordering (text column can't sort by severity).
const priorityRank = sql`case ${tasks.priority}
  when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`;

export const createTaskInput = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(20_000).optional(),
  accountId: z.string().uuid().nullish(),
  projectId: z.string().uuid().nullish(),
  status: z.enum(TASK_STATUSES).default("todo"),
  priority: z.enum(TASK_PRIORITIES).default("normal"),
  assigneeId: z.string().uuid().nullish(),
  dueAt: z.coerce.date().nullish(),
  estimateMinutes: z.number().int().positive().max(100_000).nullish(),
  clientVisible: z.boolean().default(false),
});

export const updateTaskInput = createTaskInput.partial();

export const taskFilters = z.object({
  assignee: z.string().uuid().optional(),
  account: z.string().uuid().optional(),
  project: z.string().uuid().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  // due buckets for the My Tasks view
  due: z.enum(["overdue", "today", "week"]).optional(),
});

export type TaskWithAssignee = Task & { assigneeName: string | null };

/**
 * Account scope predicate for task reads.
 *  - internal: all tasks (including agency-internal ones with null account_id)
 *  - client: only client_visible tasks inside accounts they belong to;
 *    null-account tasks are agency-internal and never visible to clients.
 */
function readScope(viewer: Viewer): SQL | undefined {
  if (isInternal(viewer)) return undefined;
  const scope = accessibleAccountIds(viewer);
  if (scope === "all" || scope.length === 0) {
    // client with no memberships sees nothing
    return eq(tasks.id, "00000000-0000-0000-0000-000000000000");
  }
  return and(eq(tasks.clientVisible, true), inArray(tasks.accountId, [...scope]));
}

function dueBucket(bucket: "overdue" | "today" | "week"): SQL | undefined {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
  if (bucket === "overdue") return and(isNotNull(tasks.dueAt), lt(tasks.dueAt, startOfToday));
  if (bucket === "today") return and(gte(tasks.dueAt, startOfToday), lt(tasks.dueAt, endOfToday));
  // "week": from now through 7 days out
  const weekOut = new Date(startOfToday.getTime() + 7 * 24 * 60 * 60 * 1000);
  return and(gte(tasks.dueAt, startOfToday), lte(tasks.dueAt, weekOut));
}

export async function listTasks(
  viewer: Viewer,
  filters: z.infer<typeof taskFilters>,
): Promise<Result<TaskWithAssignee[]>> {
  const conditions: (SQL | undefined)[] = [readScope(viewer)];
  if (filters.assignee) conditions.push(eq(tasks.assigneeId, filters.assignee));
  if (filters.account) conditions.push(eq(tasks.accountId, filters.account));
  if (filters.project) conditions.push(eq(tasks.projectId, filters.project));
  if (filters.status) conditions.push(eq(tasks.status, filters.status));
  if (filters.due) conditions.push(dueBucket(filters.due));

  const rows = await db
    .select({
      task: tasks,
      assigneeName: users.name,
    })
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .where(and(...conditions.filter(Boolean)))
    // urgent first, then soonest due, then newest
    .orderBy(priorityRank, asc(tasks.dueAt), desc(tasks.createdAt));

  return ok(rows.map((r) => ({ ...r.task, assigneeName: r.assigneeName })));
}

/** Load one task with the same visibility rules; null if not visible. */
async function loadVisibleTask(viewer: Viewer, id: string): Promise<Task | null> {
  const [row] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), readScope(viewer)));
  return row ?? null;
}

export type TaskDetail = {
  task: Task;
  checklist: (typeof taskChecklist.$inferSelect)[];
  comments: { id: string; body: string; authorId: string; authorName: string; parentId: string | null; createdAt: Date }[];
};

export async function getTask(viewer: Viewer, id: string): Promise<Result<TaskDetail>> {
  const task = await loadVisibleTask(viewer, id);
  if (!task) return err("not_found", "Task not found");
  const [checklist, comments] = await Promise.all([
    db.select().from(taskChecklist).where(eq(taskChecklist.taskId, id)).orderBy(asc(taskChecklist.position)),
    db
      .select({
        id: taskComments.id,
        body: taskComments.body,
        authorId: taskComments.authorId,
        authorName: users.name,
        parentId: taskComments.parentId,
        createdAt: taskComments.createdAt,
      })
      .from(taskComments)
      .innerJoin(users, eq(users.id, taskComments.authorId))
      .where(eq(taskComments.taskId, id))
      .orderBy(asc(taskComments.createdAt)),
  ]);
  return ok({ task, checklist, comments });
}

async function assertAccountWritable(viewer: Viewer, accountId?: string | null): Promise<Result<true>> {
  // Tasks are internal-authored in v1 (docs/04: client_visible is read-only for
  // clients). Only internal users create/mutate tasks.
  if (!isInternal(viewer)) return err("forbidden", "Only the team can manage tasks");
  if (accountId) {
    // account must be one an internal user can see (all of them) — cheap guard
    // that also keeps the FK honest for typo'd ids handled by the DB.
  }
  return ok(true);
}

export async function createTask(
  viewer: Viewer,
  input: z.infer<typeof createTaskInput>,
): Promise<Result<Task>> {
  const guard = await assertAccountWritable(viewer, input.accountId);
  if (!guard.ok) return guard as Result<never>;

  const [row] = await db
    .insert(tasks)
    .values({
      title: input.title,
      description: input.description ?? null,
      accountId: input.accountId ?? null,
      projectId: input.projectId ?? null,
      status: input.status,
      priority: input.priority,
      assigneeId: input.assigneeId ?? null,
      dueAt: input.dueAt ?? null,
      estimateMinutes: input.estimateMinutes ?? null,
      clientVisible: input.clientVisible,
      completedAt: input.status === "done" ? new Date() : null,
    })
    .returning();
  // Notify on assign (docs/04) — but not if you assigned it to yourself.
  if (row!.assigneeId && row!.assigneeId !== viewer.id) {
    void notify([row!.assigneeId], {
      kind: "task_assigned",
      body: { taskId: row!.id, title: row!.title },
    });
  }
  return ok(row!);
}

export type UpdateTaskResult = { task: Task; checklistWarning?: string };

export async function updateTask(
  viewer: Viewer,
  id: string,
  input: z.infer<typeof updateTaskInput>,
): Promise<Result<UpdateTaskResult>> {
  const existing = await loadVisibleTask(viewer, id);
  if (!existing) return err("not_found", "Task not found");
  const guard = await assertAccountWritable(viewer, existing.accountId);
  if (!guard.ok) return guard as Result<never>;

  const patch: Partial<typeof tasks.$inferInsert> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description ?? null;
  if (input.accountId !== undefined) patch.accountId = input.accountId ?? null;
  if (input.projectId !== undefined) patch.projectId = input.projectId ?? null;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.assigneeId !== undefined) patch.assigneeId = input.assigneeId ?? null;
  if (input.dueAt !== undefined) patch.dueAt = input.dueAt ?? null;
  if (input.estimateMinutes !== undefined) patch.estimateMinutes = input.estimateMinutes ?? null;
  if (input.clientVisible !== undefined) patch.clientVisible = input.clientVisible;

  let checklistWarning: string | undefined;
  if (input.status !== undefined && input.status !== existing.status) {
    patch.status = input.status;
    // completed_at tracks the done transition
    if (input.status === "done") {
      patch.completedAt = new Date();
      // Completing with an open checklist warns but allows (docs/04 rule).
      const openItems = await db
        .select({ id: taskChecklist.id })
        .from(taskChecklist)
        .where(and(eq(taskChecklist.taskId, id), eq(taskChecklist.done, false)));
      if (openItems.length > 0) {
        checklistWarning = `Completed with ${openItems.length} unchecked checklist item${openItems.length > 1 ? "s" : ""}.`;
      }
    } else if (existing.status === "done") {
      patch.completedAt = null; // reopened
    }
  }

  const [row] = await db.update(tasks).set(patch).where(eq(tasks.id, id)).returning();
  // Notify on (re)assignment to someone other than the actor.
  if (
    input.assigneeId !== undefined &&
    row!.assigneeId &&
    row!.assigneeId !== existing.assigneeId &&
    row!.assigneeId !== viewer.id
  ) {
    void notify([row!.assigneeId], {
      kind: "task_assigned",
      body: { taskId: row!.id, title: row!.title },
    });
  }
  return ok({ task: row!, checklistWarning });
}

// ===== Checklist =====

export const checklistItemInput = z.object({
  label: z.string().trim().min(1).max(500),
});

export async function addChecklistItem(
  viewer: Viewer,
  taskId: string,
  input: z.infer<typeof checklistItemInput>,
): Promise<Result<typeof taskChecklist.$inferSelect>> {
  const task = await loadVisibleTask(viewer, taskId);
  if (!task) return err("not_found", "Task not found");
  const guard = await assertAccountWritable(viewer, task.accountId);
  if (!guard.ok) return guard as Result<never>;
  const [maxRow] = await db
    .select({ max: sql<number>`coalesce(max(${taskChecklist.position}), -1)` })
    .from(taskChecklist)
    .where(eq(taskChecklist.taskId, taskId));
  const [row] = await db
    .insert(taskChecklist)
    .values({ taskId, label: input.label, position: (maxRow?.max ?? -1) + 1 })
    .returning();
  return ok(row!);
}

export async function toggleChecklistItem(
  viewer: Viewer,
  taskId: string,
  itemId: string,
  done: boolean,
): Promise<Result<typeof taskChecklist.$inferSelect>> {
  const task = await loadVisibleTask(viewer, taskId);
  if (!task) return err("not_found", "Task not found");
  const guard = await assertAccountWritable(viewer, task.accountId);
  if (!guard.ok) return guard as Result<never>;
  const [row] = await db
    .update(taskChecklist)
    .set({ done })
    .where(and(eq(taskChecklist.id, itemId), eq(taskChecklist.taskId, taskId)))
    .returning();
  if (!row) return err("not_found", "Checklist item not found");
  return ok(row);
}
