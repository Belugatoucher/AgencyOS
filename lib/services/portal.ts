import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { canViewAccount, type Viewer } from "@/lib/access";
import { db } from "@/lib/db";
import {
  accounts,
  collections,
  meetingNotes,
  meetings,
  posts,
  reviewApprovals,
  reviewItems,
  reviewVersions,
  tasks,
} from "@/lib/db/schema";
import { err, ok, type Result } from "@/lib/result";

// Portal (docs/11): a filtered VIEW over existing modules — no new permission
// logic. Everything here re-applies the same client rules the module services
// enforce (client_visible + membership); the portal cannot render what those
// rules hide, by construction.

export type PortalHome = {
  accountName: string;
  reviewsAwaiting: { id: string; title: string; versionNo: number }[];
  postsAwaiting: { id: string; body: string | null; channels: string[]; scheduledAt: string | null }[];
  tasksFlagged: { id: string; title: string; status: string; dueAt: string | null }[];
};

function portalGuard(viewer: Viewer, accountId: string): Result<true> {
  // clients: membership; internal: preview access
  if (!canViewAccount(viewer, accountId)) return err("not_found", "Account not found");
  return ok(true);
}

/** The home action stack: everything awaiting the client's eyes. */
export async function getPortalHome(viewer: Viewer, accountId: string): Promise<Result<PortalHome>> {
  const g = portalGuard(viewer, accountId);
  if (!g.ok) return g as Result<never>;
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  if (!account || account.deletedAt) return err("not_found", "Account not found");

  // Reviews awaiting: client_visible items whose LATEST version is ready and
  // has no approval decision yet.
  const items = await db
    .select()
    .from(reviewItems)
    .where(
      and(eq(reviewItems.accountId, accountId), eq(reviewItems.clientVisible, true), isNull(reviewItems.deletedAt)),
    )
    .orderBy(desc(reviewItems.createdAt));
  const reviewsAwaiting: PortalHome["reviewsAwaiting"] = [];
  for (const item of items) {
    const [latest] = await db
      .select()
      .from(reviewVersions)
      .where(eq(reviewVersions.itemId, item.id))
      .orderBy(desc(reviewVersions.versionNo))
      .limit(1);
    if (!latest) continue;
    const [approval] = await db
      .select()
      .from(reviewApprovals)
      .where(eq(reviewApprovals.versionId, latest.id))
      .orderBy(desc(reviewApprovals.createdAt))
      .limit(1);
    if (!approval || approval.decision !== "approved") {
      reviewsAwaiting.push({ id: item.id, title: item.title, versionNo: latest.versionNo });
    }
  }

  const postsAwaiting = await db
    .select({ id: posts.id, body: posts.body, channels: posts.channels, scheduledAt: posts.scheduledAt })
    .from(posts)
    .where(and(eq(posts.accountId, accountId), eq(posts.status, "in_approval")))
    .orderBy(posts.scheduledAt);

  const tasksFlagged = await db
    .select({ id: tasks.id, title: tasks.title, status: tasks.status, dueAt: tasks.dueAt })
    .from(tasks)
    .where(and(eq(tasks.accountId, accountId), eq(tasks.clientVisible, true), ne(tasks.status, "done")))
    .orderBy(tasks.dueAt);

  return ok({
    accountName: account.name,
    reviewsAwaiting,
    postsAwaiting: postsAwaiting.map((p) => ({ ...p, scheduledAt: p.scheduledAt?.toISOString() ?? null })),
    tasksFlagged: tasksFlagged.map((t) => ({ ...t, dueAt: t.dueAt?.toISOString() ?? null })),
  });
}

/** Client-visible meetings: shared recaps only — summary, never raw transcript. */
export async function portalMeetings(viewer: Viewer, accountId: string) {
  const g = portalGuard(viewer, accountId);
  if (!g.ok) return g as Result<never>;
  const rows = await db
    .select({
      id: meetings.id,
      title: meetings.title,
      occurredAt: meetings.occurredAt,
      summary: meetingNotes.summary,
    })
    .from(meetings)
    .leftJoin(meetingNotes, eq(meetingNotes.meetingId, meetings.id))
    .where(and(eq(meetings.accountId, accountId), eq(meetings.clientVisible, true)))
    .orderBy(desc(meetings.occurredAt))
    .limit(50);
  return ok(rows);
}

/** Shared collections for the Files page (reuses collections listing rules). */
export async function portalCollections(viewer: Viewer, accountId: string) {
  const g = portalGuard(viewer, accountId);
  if (!g.ok) return g as Result<never>;
  const rows = await db
    .select({ id: collections.id, name: collections.name })
    .from(collections)
    .where(eq(collections.accountId, accountId))
    .orderBy(desc(collections.createdAt))
    .limit(50);
  return ok(rows);
}
