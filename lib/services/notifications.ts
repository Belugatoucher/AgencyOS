import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications, type Notification } from "@/lib/db/schema";
import { ok, type Result } from "@/lib/result";
import { postToSlack } from "@/lib/slack";
import type { Viewer } from "@/lib/access";

export type NotifyEvent = {
  kind: string; // e.g. member_invited|file_uploaded — module events land later
  body: Record<string, unknown>; // rendered by the bell; keep it small
  slackText?: string; // optional mirror to the Slack webhook
};

/** Dispatcher (docs/00): writes in-app rows per user, mirrors to Slack once. */
export async function notify(userIds: string[], event: NotifyEvent): Promise<void> {
  const unique = [...new Set(userIds)];
  if (unique.length > 0) {
    await db
      .insert(notifications)
      .values(unique.map((userId) => ({ userId, kind: event.kind, body: event.body })));
  }
  if (event.slackText) await postToSlack(event.slackText);
}

export async function listNotifications(
  viewer: Viewer,
): Promise<Result<{ items: Notification[]; unread: number }>> {
  const items = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, viewer.id))
    .orderBy(desc(notifications.createdAt))
    .limit(20);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, viewer.id), isNull(notifications.readAt)));
  return ok({ items, unread: row?.count ?? 0 });
}

export async function markAllRead(viewer: Viewer): Promise<Result<{ read: true }>> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, viewer.id), isNull(notifications.readAt)));
  return ok({ read: true });
}
