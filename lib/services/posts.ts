import { and, asc, eq, gte, lte, type SQL } from "drizzle-orm";
import { z } from "zod";
import { canMutateAccount, canViewAccount, isInternal, type Viewer } from "@/lib/access";
import { db } from "@/lib/db";
import { accounts, assetUsage, postApprovals, posts, type Post } from "@/lib/db/schema";
import { err, ok, type Result } from "@/lib/result";
import { notify } from "./notifications";
import { CHANNELS, validatePost, type ValidationIssue } from "@/lib/scheduler/channels";

export const POST_STATUSES = ["idea", "draft", "in_approval", "approved", "scheduled", "published", "failed"] as const;

export const createPostInput = z.object({
  accountId: z.string().uuid(),
  channels: z.array(z.enum(CHANNELS)).min(1).max(5),
  body: z.string().max(63206).nullish(),
  channelOverrides: z.record(z.string(), z.object({ body: z.string().max(63206).optional() })).default({}),
  media: z.array(z.string().uuid()).max(20).default([]),
  scheduledAt: z.coerce.date().nullish(),
  approvalRequired: z.boolean().default(true),
});

export const updatePostInput = createPostInput.partial().extend({
  status: z.enum(POST_STATUSES).optional(),
});

export const postFilters = z.object({
  account: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  status: z.enum(POST_STATUSES).optional(),
});

export type PostWithIssues = Post & { issues: ValidationIssue[] };

function issuesFor(p: Pick<Post, "channels" | "body" | "channelOverrides" | "media">): ValidationIssue[] {
  return validatePost({
    channels: p.channels,
    body: p.body,
    channelOverrides: (p.channelOverrides as Record<string, { body?: string }>) ?? {},
    mediaCount: (p.media ?? []).length,
  });
}

export async function listPosts(
  viewer: Viewer,
  filters: z.infer<typeof postFilters>,
): Promise<Result<PostWithIssues[]>> {
  const conds: (SQL | undefined)[] = [];
  if (filters.account) {
    if (!canViewAccount(viewer, filters.account)) return err("not_found", "Account not found");
    conds.push(eq(posts.accountId, filters.account));
  } else if (!isInternal(viewer)) {
    // clients scope to their accounts (master view is internal)
    const { accessibleAccountIds } = await import("@/lib/access");
    const ids = accessibleAccountIds(viewer);
    if (ids === "all" || ids.length === 0) return ok([]);
    const { inArray } = await import("drizzle-orm");
    conds.push(inArray(posts.accountId, [...ids]));
  }
  if (filters.from) conds.push(gte(posts.scheduledAt, filters.from));
  if (filters.to) conds.push(lte(posts.scheduledAt, filters.to));
  if (filters.status) conds.push(eq(posts.status, filters.status));

  const rows = await db
    .select()
    .from(posts)
    .where(conds.length ? and(...conds.filter(Boolean)) : undefined)
    .orderBy(asc(posts.scheduledAt));
  return ok(rows.map((p) => ({ ...p, issues: issuesFor(p) })));
}

async function loadPost(id: string): Promise<Post | null> {
  const [row] = await db.select().from(posts).where(eq(posts.id, id));
  return row ?? null;
}

export async function createPost(
  viewer: Viewer,
  input: z.infer<typeof createPostInput>,
): Promise<Result<PostWithIssues>> {
  if (!canViewAccount(viewer, input.accountId)) return err("not_found", "Account not found");
  if (!canMutateAccount(viewer, input.accountId)) return err("forbidden", "Only the team can create posts");
  const [row] = await db
    .insert(posts)
    .values({
      accountId: input.accountId,
      channels: input.channels,
      body: input.body ?? null,
      channelOverrides: input.channelOverrides,
      media: input.media,
      scheduledAt: input.scheduledAt ?? null,
      approvalRequired: input.approvalRequired,
      status: "draft",
      createdBy: viewer.id,
    })
    .returning();
  return ok({ ...row!, issues: issuesFor(row!) });
}

/**
 * Update a post. Scheduling (status → scheduled) is gated: media must validate,
 * and if approval_required the post can't skip approval (docs/06 hard stop).
 */
export async function updatePost(
  viewer: Viewer,
  id: string,
  input: z.infer<typeof updatePostInput>,
): Promise<Result<PostWithIssues>> {
  const existing = await loadPost(id);
  if (!existing || !canViewAccount(viewer, existing.accountId)) return err("not_found", "Post not found");
  if (!canMutateAccount(viewer, existing.accountId)) return err("forbidden", "Only the team can edit posts");

  const patch: Partial<typeof posts.$inferInsert> = {};
  if (input.channels !== undefined) patch.channels = input.channels;
  if (input.body !== undefined) patch.body = input.body ?? null;
  if (input.channelOverrides !== undefined) patch.channelOverrides = input.channelOverrides;
  if (input.media !== undefined) patch.media = input.media;
  if (input.scheduledAt !== undefined) patch.scheduledAt = input.scheduledAt ?? null;
  if (input.approvalRequired !== undefined) patch.approvalRequired = input.approvalRequired;

  if (input.status !== undefined && input.status !== existing.status) {
    const next = input.status;
    const merged = { ...existing, ...patch } as Post;
    if (next === "scheduled") {
      const issues = issuesFor(merged);
      if (issues.length) return err("invalid", `Fix channel issues before scheduling: ${issues[0]!.message}`);
      if (!merged.scheduledAt) return err("invalid", "Set a scheduled time before scheduling");
      if (merged.approvalRequired && merged.status !== "approved") {
        return err("conflict", "This post needs approval before it can be scheduled");
      }
    }
    if (next === "in_approval" && merged.approvalRequired === false) {
      return err("invalid", "Post does not require approval");
    }
    patch.status = next;
  }

  if (Object.keys(patch).length === 0) return ok({ ...existing, issues: issuesFor(existing) });
  const [row] = await db.update(posts).set(patch).where(eq(posts.id, id)).returning();

  // Record media usage backlinks when media changes (docs/05 usage tracking).
  if (input.media?.length) {
    // clear prior post-usage rows for this post, then re-record
    await db.delete(assetUsage).where(and(eq(assetUsage.usedIn, "post"), eq(assetUsage.usedInId, id)));
    await db.insert(assetUsage).values(input.media.map((assetId) => ({ assetId, usedIn: "post", usedInId: id })));
  }
  return ok({ ...row!, issues: issuesFor(row!) });
}

// ===== Approval (internal or client via portal card) =====

export const approvalInput = z.object({
  decision: z.enum(["approved", "rejected"]),
  comment: z.string().max(2000).optional(),
  // docs/11: rejections carry line-level suggestions, not bare "no"s
  suggestions: z
    .array(z.object({ current: z.string().min(1).max(2000), proposed: z.string().min(1).max(2000) }))
    .max(20)
    .default([]),
});

export async function decidePost(
  viewer: Viewer,
  id: string,
  input: z.infer<typeof approvalInput>,
): Promise<Result<Post>> {
  const post = await loadPost(id);
  if (!post || !canViewAccount(viewer, post.accountId)) return err("not_found", "Post not found");
  // Approvers are internal, or the client (a member of the account) via portal.
  if (!isInternal(viewer)) {
    const { memberships } = await import("@/lib/db/schema");
    const m = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, viewer.id), eq(memberships.accountId, post.accountId)));
    if (m.length === 0) return err("not_found", "Post not found");
  }

  // No vague feedback (docs/11): rejecting asks for {current, proposed} line
  // suggestions on the copy instead of a bare rejection.
  if (input.decision === "rejected" && input.suggestions.length === 0) {
    return err("invalid", "Suggest at least one copy change so the team knows what to fix");
  }

  await db.insert(postApprovals).values({
    postId: id,
    decision: input.decision,
    decidedBy: viewer.id,
    comment: input.comment ?? null,
    suggestions: input.suggestions,
  });
  const [row] = await db
    .update(posts)
    .set({ status: input.decision === "approved" ? "approved" : "draft" })
    .where(eq(posts.id, id))
    .returning();

  // Notify the post creator; portal (client) actions also page the team's
  // Slack within seconds (docs/11).
  const fromClient = !isInternal(viewer);
  if (post.createdBy && post.createdBy !== viewer.id) {
    void notify([post.createdBy], {
      kind: input.decision === "approved" ? "post_approved" : "post_rejected",
      body: { postId: id, comment: input.comment, suggestions: input.suggestions },
      slackText: fromClient
        ? `📣 Portal: a client ${input.decision === "approved" ? "approved" : `requested ${input.suggestions.length} change(s) on`} a post`
        : undefined,
    });
  }
  return ok(row!);
}

export async function getPost(viewer: Viewer, id: string): Promise<Result<PostWithIssues>> {
  const post = await loadPost(id);
  if (!post || !canViewAccount(viewer, post.accountId)) return err("not_found", "Post not found");
  return ok({ ...post, issues: issuesFor(post) });
}

// account name helper for the AI drafting user message
export async function accountBrand(accountId: string): Promise<{ name: string; brand: Record<string, unknown> } | null> {
  const [a] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  if (!a) return null;
  return { name: a.name, brand: (a.brand as Record<string, unknown>) ?? {} };
}
