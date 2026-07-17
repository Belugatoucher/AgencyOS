import { randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { canMutateAccount, canViewAccount, type Viewer } from "@/lib/access";
import { db } from "@/lib/db";
import { reviewItems, shareLinks, type ShareLink } from "@/lib/db/schema";
import { err, ok, type Result } from "@/lib/result";
import { rateLimit } from "@/lib/rate-limit";

export const mintShareInput = z.object({
  expiresInDays: z.number().int().min(1).max(90).default(14),
  pin: z.string().regex(/^\d{4}$/).optional(),
  canComment: z.boolean().default(true),
  latestOnly: z.boolean().default(false),
});

/** Mint a review-item share link (docs/01: 14-day expiry + optional PIN). */
export async function mintReviewShare(
  viewer: Viewer,
  itemId: string,
  input: z.infer<typeof mintShareInput>,
): Promise<Result<{ token: string; url: string }>> {
  const [item] = await db.select().from(reviewItems).where(eq(reviewItems.id, itemId));
  if (!item || !canViewAccount(viewer, item.accountId)) return err("not_found", "Review item not found");
  if (!canMutateAccount(viewer, item.accountId)) return err("forbidden", "Only the team can share");

  const token = randomBytes(24).toString("base64url"); // ≥128-bit CSPRNG (audit item 1)
  const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);
  await db.insert(shareLinks).values({
    token,
    kind: "review_item",
    targetId: itemId,
    pin: input.pin ?? null,
    canComment: input.canComment,
    latestOnly: input.latestOnly,
    expiresAt,
    createdBy: viewer.id,
  });
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return ok({ token, url: `${base}/r/${token}` });
}

export async function revokeShare(viewer: Viewer, token: string): Promise<Result<{ revoked: true }>> {
  const link = await loadLink(token);
  if (!link) return err("not_found", "Share link not found");
  const targetOk =
    link.kind === "review_item"
      ? await reviewItemAccountAllows(viewer, link.targetId)
      : false;
  if (!targetOk) return err("not_found", "Share link not found");
  // Revoke = expire now; media URLs are short-lived so playback dies naturally.
  await db.update(shareLinks).set({ expiresAt: new Date() }).where(eq(shareLinks.token, token));
  return ok({ revoked: true });
}

async function reviewItemAccountAllows(viewer: Viewer, itemId: string): Promise<boolean> {
  const [item] = await db.select().from(reviewItems).where(eq(reviewItems.id, itemId));
  return !!item && canMutateAccount(viewer, item.accountId);
}

async function loadLink(token: string): Promise<ShareLink | null> {
  const [row] = await db.select().from(shareLinks).where(eq(shareLinks.token, token));
  return row ?? null;
}

export type ResolvedLink =
  | { status: "not_found" }
  | { status: "expired" }
  | { status: "pin_required" }
  | { status: "locked_out" }
  | { status: "ok"; link: ShareLink };

/**
 * Resolve a share token, enforcing expiry and (when set) a PIN. PIN attempts
 * are rate-limited 5 per 15 min per token+IP, then locked out with an owner
 * notification (audit item 1). `pin` is undefined for the initial GET.
 */
export async function resolveShareLink(
  token: string,
  ip: string,
  pin?: string,
): Promise<ResolvedLink> {
  const link = await loadLink(token);
  if (!link) return { status: "not_found" };
  if (link.expiresAt.getTime() <= Date.now()) return { status: "expired" };

  if (link.pin) {
    if (pin === undefined) return { status: "pin_required" };
    const limit = await rateLimit({ key: `pin:${token}:${ip}`, limit: 5, windowSeconds: 15 * 60 });
    if (!limit.ok) {
      // lockout + owner notification (once per window is enough; keyed separately)
      const first = await rateLimit({ key: `pinlock:${token}`, limit: 1, windowSeconds: 15 * 60 });
      if (first.ok && link.createdBy) {
        const { notify } = await import("./notifications");
        void notify([link.createdBy], {
          kind: "share_link_pin_lockout",
          body: { token: token.slice(0, 8), kind: link.kind },
          slackText: `🔒 Repeated failed PIN attempts on a share link (…${token.slice(-6)})`,
        });
      }
      return { status: "locked_out" };
    }
    // constant-time compare
    const a = Buffer.from(link.pin);
    const b = Buffer.from(pin);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { status: "pin_required" };
  }

  return { status: "ok", link };
}

/** Load the share link and confirm it targets a given review item (guest actor). */
export async function shareLinkForItem(token: string): Promise<ShareLink | null> {
  const link = await loadLink(token);
  if (!link || link.kind !== "review_item") return null;
  if (link.expiresAt.getTime() <= Date.now()) return null;
  return link;
}
