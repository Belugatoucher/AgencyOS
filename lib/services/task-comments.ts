import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { isInternal, type Viewer } from "@/lib/access";
import { db } from "@/lib/db";
import { taskComments, tasks, users } from "@/lib/db/schema";
import { err, ok, type Result } from "@/lib/result";
import { notify } from "./notifications";

export const commentInput = z.object({
  body: z.string().trim().min(1).max(10_000),
  parentId: z.string().uuid().nullish(), // threaded once — a reply's parent must be top-level
});

// @mentions by email; resolved to users so we can notify them.
function extractMentions(body: string): string[] {
  const matches = body.match(/@([\w.+-]+@[\w.-]+\.\w+)/g) ?? [];
  return [...new Set(matches.map((m) => m.slice(1).toLowerCase()))];
}

export async function addComment(
  viewer: Viewer,
  taskId: string,
  input: z.infer<typeof commentInput>,
): Promise<Result<typeof taskComments.$inferSelect>> {
  // Comments are internal collaboration in v1.
  if (!isInternal(viewer)) return err("forbidden", "Only the team can comment on tasks");

  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) return err("not_found", "Task not found");

  // Enforce "threaded once": a parent, if given, must itself be a top-level
  // comment on this task (no replies to replies).
  if (input.parentId) {
    const [parent] = await db
      .select()
      .from(taskComments)
      .where(and(eq(taskComments.id, input.parentId), eq(taskComments.taskId, taskId)));
    if (!parent) return err("invalid", "Reply target not found on this task");
    if (parent.parentId) return err("invalid", "Comments can only be nested one level deep");
  }

  const [row] = await db
    .insert(taskComments)
    .values({ taskId, authorId: viewer.id, body: input.body, parentId: input.parentId ?? null })
    .returning();

  // Notify mentioned users (excluding the author) + the assignee.
  const mentionEmails = extractMentions(input.body);
  const notifyUserIds = new Set<string>();
  if (mentionEmails.length) {
    const mentioned = await db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.email, mentionEmails));
    mentioned.forEach((u) => notifyUserIds.add(u.id));
  }
  if (task.assigneeId) notifyUserIds.add(task.assigneeId);
  notifyUserIds.delete(viewer.id);

  if (notifyUserIds.size) {
    void notify([...notifyUserIds], {
      kind: "task_comment",
      body: { taskId, taskTitle: task.title, preview: input.body.slice(0, 140) },
    });
  }

  return ok(row!);
}
