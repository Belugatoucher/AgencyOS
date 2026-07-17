import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { canMutateAccount, canViewAccount, isInternal, type Viewer } from "@/lib/access";
import { db } from "@/lib/db";
import {
  files,
  memberships,
  reviewApprovals,
  reviewComments,
  reviewItems,
  reviewVersions,
  tasks,
  users,
  type ReviewComment,
  type ReviewItem,
  type ReviewVersion,
} from "@/lib/db/schema";
import { err, ok, type Result } from "@/lib/result";
import { getQueue } from "@/lib/queues";
import { notify } from "./notifications";

// A comment/approval actor is either an authenticated internal user or a
// share-link guest (docs/01). Guests are scoped to one item and named once.
export type Actor =
  | { type: "user"; id: string; role: Viewer["role"] }
  | { type: "guest"; shareLinkId: string; guestName: string; itemId: string; canComment: boolean };

// ===== Items =====

export const itemInput = z.object({
  accountId: z.string().uuid(),
  projectId: z.string().uuid().nullish(),
  title: z.string().trim().min(1).max(300),
  clientVisible: z.boolean().default(true),
});

export async function createItem(
  viewer: Viewer,
  input: z.infer<typeof itemInput>,
): Promise<Result<ReviewItem>> {
  if (!canViewAccount(viewer, input.accountId)) return err("not_found", "Account not found");
  if (!canMutateAccount(viewer, input.accountId)) return err("forbidden", "Only the team can create review items");
  const [row] = await db
    .insert(reviewItems)
    .values({
      accountId: input.accountId,
      projectId: input.projectId ?? null,
      title: input.title,
      clientVisible: input.clientVisible,
    })
    .returning();
  return ok(row!);
}

export async function listItems(viewer: Viewer, accountId: string): Promise<Result<ReviewItem[]>> {
  if (!canViewAccount(viewer, accountId)) return err("not_found", "Account not found");
  const rows = await db
    .select()
    .from(reviewItems)
    .where(and(eq(reviewItems.accountId, accountId), isNull(reviewItems.deletedAt)))
    .orderBy(desc(reviewItems.createdAt));
  // clients only see client_visible items
  return ok(isInternal(viewer) ? rows : rows.filter((r) => r.clientVisible));
}

export type ItemDetail = {
  item: ReviewItem;
  versions: (ReviewVersion & { openComments: number; openChanges: number })[];
};

async function loadItem(id: string): Promise<ReviewItem | null> {
  const [row] = await db
    .select()
    .from(reviewItems)
    .where(and(eq(reviewItems.id, id), isNull(reviewItems.deletedAt)));
  return row ?? null;
}

export async function getItem(viewer: Viewer, id: string): Promise<Result<ItemDetail>> {
  const item = await loadItem(id);
  if (!item || !canViewAccount(viewer, item.accountId)) return err("not_found", "Review item not found");
  if (!isInternal(viewer) && !item.clientVisible) return err("not_found", "Review item not found");
  return ok(await buildItemDetail(item));
}

async function buildItemDetail(item: ReviewItem): Promise<ItemDetail> {
  const versions = await db
    .select()
    .from(reviewVersions)
    .where(eq(reviewVersions.itemId, item.id))
    .orderBy(desc(reviewVersions.versionNo));
  const withCounts = await Promise.all(
    versions.map(async (v) => {
      const [c] = await db
        .select({
          openComments: sql<number>`count(*) filter (where ${reviewComments.resolvedAt} is null and ${reviewComments.kind} = 'note')::int`,
          openChanges: sql<number>`count(*) filter (where ${reviewComments.kind} = 'change' and ${reviewComments.changeStatus} in ('open','accepted'))::int`,
        })
        .from(reviewComments)
        .where(eq(reviewComments.versionId, v.id));
      return { ...v, openComments: c?.openComments ?? 0, openChanges: c?.openChanges ?? 0 };
    }),
  );
  return { item, versions: withCounts };
}

// ===== Versions =====

export const versionInput = z.object({
  fileId: z.string().uuid(),
});

export async function addVersion(
  viewer: Viewer,
  itemId: string,
  input: z.infer<typeof versionInput>,
): Promise<Result<ReviewVersion>> {
  const item = await loadItem(itemId);
  if (!item || !canViewAccount(viewer, item.accountId)) return err("not_found", "Review item not found");
  if (!canMutateAccount(viewer, item.accountId)) return err("forbidden", "Only the team can add versions");
  const [file] = await db.select().from(files).where(eq(files.id, input.fileId));
  if (!file || file.accountId !== item.accountId) return err("invalid", "File not found for account");

  const [maxRow] = await db
    .select({ max: sql<number>`coalesce(max(${reviewVersions.versionNo}), 0)` })
    .from(reviewVersions)
    .where(eq(reviewVersions.itemId, itemId));

  const [version] = await db
    .insert(reviewVersions)
    .values({ itemId, versionNo: (maxRow?.max ?? 0) + 1, fileId: input.fileId, status: "processing" })
    .returning();

  // Enqueue transcode (media queue) — poster + sprite + HLS for video (docs/01).
  await getQueue("media").add("review-transcode", { versionId: version!.id });
  return ok(version!);
}

// ===== Comments =====

export const commentInput = z.object({
  body: z.string().trim().min(1).max(10_000),
  timestampMs: z.number().int().min(0).nullish(),
  timestampEndMs: z.number().int().min(0).nullish(),
  region: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).nullish(),
  drawing: z.unknown().nullish(),
  parentId: z.string().uuid().nullish(),
  kind: z.enum(["note", "change"]).default("note"),
  suggestion: z.object({ current: z.string().max(2000), proposed: z.string().max(2000) }).nullish(),
});

async function versionWithItem(versionId: string) {
  const [row] = await db
    .select({ version: reviewVersions, item: reviewItems })
    .from(reviewVersions)
    .innerJoin(reviewItems, eq(reviewItems.id, reviewVersions.itemId))
    .where(eq(reviewVersions.id, versionId));
  return row ?? null;
}

export async function addComment(
  actor: Actor,
  versionId: string,
  input: z.infer<typeof commentInput>,
): Promise<Result<ReviewComment>> {
  const vi = await versionWithItem(versionId);
  if (!vi) return err("not_found", "Version not found");

  // Authorize the actor for this version.
  if (actor.type === "user") {
    if (!isInternal({ role: actor.role } as Viewer)) {
      // client user: must be a member of the account and item client_visible
      const membership = await db
        .select()
        .from(memberships)
        .where(and(eq(memberships.userId, actor.id), eq(memberships.accountId, vi.item.accountId)));
      if (membership.length === 0 || !vi.item.clientVisible) return err("not_found", "Version not found");
    }
  } else {
    if (actor.itemId !== vi.item.id) return err("forbidden", "Share link does not match this item");
    if (!actor.canComment) return err("forbidden", "This share link is view-only");
  }

  // threaded once — a reply's parent must be top-level and on this version
  if (input.parentId) {
    const [parent] = await db
      .select()
      .from(reviewComments)
      .where(and(eq(reviewComments.id, input.parentId), eq(reviewComments.versionId, versionId)));
    if (!parent) return err("invalid", "Reply target not found on this version");
    if (parent.parentId) return err("invalid", "Comments nest one level deep");
  }

  const [row] = await db
    .insert(reviewComments)
    .values({
      versionId,
      parentId: input.parentId ?? null,
      authorId: actor.type === "user" ? actor.id : null,
      guestName: actor.type === "guest" ? actor.guestName : null,
      shareLinkId: actor.type === "guest" ? actor.shareLinkId : null,
      timestampMs: input.timestampMs ?? null,
      timestampEndMs: input.timestampEndMs ?? null,
      region: input.region ?? null,
      drawing: input.drawing ?? null,
      kind: input.kind,
      changeStatus: input.kind === "change" ? "open" : null,
      suggestion: input.suggestion ?? null,
      body: input.body,
    })
    .returning();

  // Notify internal members of the account when a comment lands (docs/01:
  // "every guest comment notifies the uploader"). Keep it to internal users.
  const internal = await db
    .select({ userId: memberships.userId, role: users.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.accountId, vi.item.accountId));
  const notifyIds = internal.filter((m) => m.role !== "client").map((m) => m.userId);
  const actorId = actor.type === "user" ? actor.id : null;
  void notify(
    notifyIds.filter((id) => id !== actorId),
    {
      kind: "review_comment",
      body: { itemId: vi.item.id, title: vi.item.title, by: actor.type === "guest" ? actor.guestName : "team" },
    },
  );

  return ok(row!);
}

export async function listComments(versionId: string): Promise<ReviewComment[]> {
  return db
    .select()
    .from(reviewComments)
    .where(eq(reviewComments.versionId, versionId))
    .orderBy(asc(reviewComments.createdAt));
}

// resolve/change-status transitions — internal only
export const patchCommentInput = z.object({
  resolved: z.boolean().optional(),
  changeStatus: z.enum(["open", "accepted", "declined", "done"]).optional(),
  declineReason: z.string().max(2000).optional(),
});

export async function patchComment(
  viewer: Viewer,
  commentId: string,
  input: z.infer<typeof patchCommentInput>,
): Promise<Result<ReviewComment>> {
  const [comment] = await db.select().from(reviewComments).where(eq(reviewComments.id, commentId));
  if (!comment) return err("not_found", "Comment not found");
  const vi = await versionWithItem(comment.versionId);
  if (!vi || !canViewAccount(viewer, vi.item.accountId)) return err("not_found", "Comment not found");
  if (!isInternal(viewer)) return err("forbidden", "Only the team can resolve or triage comments");

  // Declining a change requires a reply so the client sees why (docs/01).
  if (input.changeStatus === "declined" && !input.declineReason) {
    return err("invalid", "Declining a change requires a reason");
  }

  const patch: Partial<typeof reviewComments.$inferInsert> = {};
  if (input.resolved !== undefined) patch.resolvedAt = input.resolved ? new Date() : null;
  if (input.changeStatus !== undefined) patch.changeStatus = input.changeStatus;
  if (Object.keys(patch).length === 0) return ok(comment);

  const [row] = await db.update(reviewComments).set(patch).where(eq(reviewComments.id, commentId)).returning();

  if (input.changeStatus === "declined" && input.declineReason) {
    await db.insert(reviewComments).values({
      versionId: comment.versionId,
      parentId: comment.id,
      authorId: viewer.id,
      kind: "note",
      body: `Declined: ${input.declineReason}`,
    });
  }
  return ok(row!);
}

/** "Send to Tasks": open changes on a version become one task with a checklist. */
export async function changesToTask(viewer: Viewer, versionId: string): Promise<Result<{ taskId: string }>> {
  const vi = await versionWithItem(versionId);
  if (!vi || !canViewAccount(viewer, vi.item.accountId)) return err("not_found", "Version not found");
  if (!isInternal(viewer)) return err("forbidden", "Only the team can create tasks");
  const changes = await db
    .select()
    .from(reviewComments)
    .where(
      and(
        eq(reviewComments.versionId, versionId),
        eq(reviewComments.kind, "change"),
        eq(reviewComments.changeStatus, "open"),
      ),
    );
  if (changes.length === 0) return err("invalid", "No open changes on this version");

  const [task] = await db
    .insert(tasks)
    .values({
      accountId: vi.item.accountId,
      title: `Review changes: ${vi.item.title} v${vi.version.versionNo}`,
      status: "todo",
      source: "review",
      sourceId: versionId,
    })
    .returning();
  const { taskChecklist } = await import("@/lib/db/schema");
  await db.insert(taskChecklist).values(
    changes.map((c, i) => ({
      taskId: task!.id,
      label: `[@${c.timestampMs ?? 0}ms] ${c.body.slice(0, 200)}`,
      position: i,
    })),
  );
  return ok({ taskId: task!.id });
}

// ===== Approvals =====

export const approvalInput = z.object({
  decision: z.enum(["approved", "changes_requested"]),
  comment: z.string().max(2000).optional(),
  approveWithExceptions: z.boolean().default(false),
});

export async function decideApproval(
  actor: Actor,
  versionId: string,
  input: z.infer<typeof approvalInput>,
): Promise<Result<{ decision: string; exceptions?: number }>> {
  const vi = await versionWithItem(versionId);
  if (!vi) return err("not_found", "Version not found");

  // Authorize actor (same rules as commenting; guests may approve if the link allows comment).
  if (actor.type === "user") {
    if (!isInternal({ role: actor.role } as Viewer)) {
      const membership = await db
        .select()
        .from(memberships)
        .where(and(eq(memberships.userId, actor.id), eq(memberships.accountId, vi.item.accountId)));
      if (membership.length === 0 || !vi.item.clientVisible) return err("not_found", "Version not found");
    }
  } else if (actor.itemId !== vi.item.id) {
    return err("forbidden", "Share link does not match this item");
  }

  // A version can't be approved while it has open changes unless the approver
  // explicitly overrides ("approve with exceptions"), which logs the list.
  let exceptions: number | undefined;
  if (input.decision === "approved") {
    const [openChanges] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(reviewComments)
      .where(
        and(
          eq(reviewComments.versionId, versionId),
          eq(reviewComments.kind, "change"),
          eq(reviewComments.changeStatus, "open"),
        ),
      );
    if ((openChanges?.n ?? 0) > 0) {
      if (!input.approveWithExceptions) {
        return err("conflict", "This version has open changes — resolve them or approve with exceptions");
      }
      exceptions = openChanges!.n;
    }
  } else {
    // "Request Changes" requires at least one kind='change' comment (docs/01).
    const [changeCount] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(reviewComments)
      .where(and(eq(reviewComments.versionId, versionId), eq(reviewComments.kind, "change")));
    if ((changeCount?.n ?? 0) === 0) {
      return err("invalid", "Request Changes needs at least one specific change comment");
    }
  }

  await db.insert(reviewApprovals).values({
    versionId,
    decision: input.decision,
    decidedBy: actor.type === "user" ? actor.id : null,
    guestName: actor.type === "guest" ? actor.guestName : null,
    comment: exceptions ? `Approved with ${exceptions} exception(s). ${input.comment ?? ""}`.trim() : (input.comment ?? null),
  });

  // Notify + Slack (docs/01: approval fires a notification + Slack ping).
  const internal = await db
    .select({ userId: memberships.userId, role: users.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.accountId, vi.item.accountId));
  void notify(
    internal.filter((m) => m.role !== "client").map((m) => m.userId),
    {
      kind: input.decision === "approved" ? "review_approved" : "review_changes_requested",
      body: { itemId: vi.item.id, title: vi.item.title, versionNo: vi.version.versionNo },
      slackText:
        input.decision === "approved"
          ? `✅ ${vi.item.title} v${vi.version.versionNo} approved${exceptions ? ` (with ${exceptions} exceptions)` : ""}`
          : `📝 Changes requested on ${vi.item.title} v${vi.version.versionNo}`,
    },
  );

  return ok({ decision: input.decision, exceptions });
}

export async function latestApproval(versionId: string) {
  const [row] = await db
    .select()
    .from(reviewApprovals)
    .where(eq(reviewApprovals.versionId, versionId))
    .orderBy(desc(reviewApprovals.createdAt))
    .limit(1);
  return row ?? null;
}
