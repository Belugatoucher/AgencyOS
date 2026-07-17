import { z } from "zod";
import { currentViewer } from "@/lib/auth/session";
import { shareLinkForItem } from "./share-links";
import type { Actor } from "./review";
import { db } from "@/lib/db";
import { reviewVersions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// Guest fields optionally present on comment/approval bodies (docs/01 route:
// "auth or valid share token"). A signed-in user takes precedence.
export const guestFields = z.object({
  shareToken: z.string().max(200).optional(),
  guestName: z.string().trim().min(1).max(120).optional(),
});

/**
 * Resolve the actor for a version-scoped action: the signed-in user if present,
 * else a share-link guest whose token targets the version's item and is unexpired.
 */
export async function resolveActor(
  versionId: string,
  guest: z.infer<typeof guestFields>,
): Promise<Actor | null> {
  const viewer = await currentViewer();
  if (viewer) return { type: "user", id: viewer.id, role: viewer.role };

  if (!guest.shareToken || !guest.guestName) return null;
  const link = await shareLinkForItem(guest.shareToken);
  if (!link) return null;
  // the link targets a review item; confirm the version belongs to it
  const [version] = await db.select().from(reviewVersions).where(eq(reviewVersions.id, versionId));
  if (!version || version.itemId !== link.targetId) return null;
  return {
    type: "guest",
    shareLinkId: link.id,
    guestName: guest.guestName,
    itemId: link.targetId,
    canComment: link.canComment,
  };
}
