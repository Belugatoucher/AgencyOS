import { eq, and, isNotNull, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { posts } from "@/lib/db/schema";
import { postToSlack } from "@/lib/slack";

// DECISION: publishing is pluggable. GHL Social Planner is the delivery arm
// (docs/06) but GHL is deferred until we have it — so the default is a
// "manual" adapter: at scheduled_at the post is marked published and the team
// posts by hand, keeping the calendar as the plan-of-record (manual-first, like
// Leads). When GHL creds are present, PUBLISH_MODE=ghl swaps in the GHL adapter
// (the only thing that gets rewritten if we ever leave GHL).
export type PublishResult =
  | { ok: true; ghlPostId: string | null; permalinks: Record<string, string> }
  | { ok: false; error: string };

export interface PublishAdapter {
  publish(post: typeof posts.$inferSelect): Promise<PublishResult>;
}

const manualAdapter: PublishAdapter = {
  async publish() {
    // Nothing to call; the team posts manually. Mark it published so the
    // calendar reflects reality; no ghl id or permalinks yet.
    return { ok: true, ghlPostId: null, permalinks: {} };
  },
};

const ghlAdapter: PublishAdapter = {
  async publish(post) {
    // GHL Social Planner push (deferred). Requires GHL_* creds + the account's
    // ghl_location_id. Left as the single rewrite point per docs/06.
    if (!process.env.GHL_CLIENT_ID) {
      return { ok: false, error: "GHL not connected" };
    }
    void post;
    return { ok: false, error: "GHL adapter not yet implemented" };
  },
};

export function publishAdapter(): PublishAdapter {
  return process.env.PUBLISH_MODE === "ghl" ? ghlAdapter : manualAdapter;
}

/** Publish one post via the active adapter; update status + page on failure. */
export async function publishPost(postId: string): Promise<{ status: string }> {
  const [post] = await db.select().from(posts).where(eq(posts.id, postId));
  if (!post) throw new Error(`Post ${postId} not found`);
  // Guard: only publish approved-or-not-required posts (docs/06 hard stop).
  if (post.approvalRequired && post.status !== "approved" && post.status !== "scheduled") {
    throw new Error(`Post ${postId} is not approved`);
  }

  const result = await publishAdapter().publish(post);
  if (result.ok) {
    await db
      .update(posts)
      .set({ status: "published", publishedAt: new Date(), ghlPostId: result.ghlPostId, permalinks: result.permalinks })
      .where(eq(posts.id, postId));
    return { status: "published" };
  }
  await db.update(posts).set({ status: "failed" }).where(eq(posts.id, postId));
  void postToSlack(`🚨 Post ${postId} failed to publish: ${result.error}`);
  throw new Error(result.error);
}

/**
 * Sweep: find approved/scheduled posts whose time has passed and enqueue a
 * publish job for each. Run by the `cron` queue every few minutes.
 */
export async function enqueueDuePosts(now = new Date()): Promise<{ enqueued: number }> {
  const { getQueue } = await import("@/lib/queues");
  const due = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.status, "scheduled"), isNotNull(posts.scheduledAt), lte(posts.scheduledAt, now)));
  for (const p of due) {
    await getQueue("publish").add("publish-post", { postId: p.id });
  }
  return { enqueued: due.length };
}
