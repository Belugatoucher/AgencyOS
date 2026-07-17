import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { files, reviewVersions, type ReviewItem, type ShareLink } from "@/lib/db/schema";
import { r2SignedGetUrl } from "@/lib/r2";
import { listComments, latestApproval } from "./review";

export type PublicVersion = {
  id: string;
  versionNo: number;
  status: string;
  mime: string;
  // short-lived signed URLs — never permanent object URLs (audit item 1)
  mediaUrl: string | null;
  hlsUrl: string | null;
  thumbUrl: string | null;
  comments: unknown[];
  approval: { decision: string; guestName: string | null; createdAt: Date } | null;
};

export type PublicItem = {
  item: { id: string; title: string };
  canComment: boolean;
  latestOnly: boolean;
  versions: PublicVersion[];
};

async function signOrNull(key: string | null): Promise<string | null> {
  if (!key) return null;
  try {
    return await r2SignedGetUrl(key);
  } catch {
    return null;
  }
}

/** Build the public review payload with per-request signed media URLs. */
export async function buildPublicItem(item: ReviewItem, link: ShareLink): Promise<PublicItem> {
  let versions = await db
    .select({ version: reviewVersions, mime: files.mime, r2Key: files.r2Key })
    .from(reviewVersions)
    .innerJoin(files, eq(files.id, reviewVersions.fileId))
    .where(eq(reviewVersions.itemId, item.id))
    .orderBy(desc(reviewVersions.versionNo));

  // latest_only hides older versions (docs/01)
  if (link.latestOnly) versions = versions.slice(0, 1);

  const publicVersions: PublicVersion[] = await Promise.all(
    versions.map(async (v) => {
      const approval = await latestApproval(v.version.id);
      return {
        id: v.version.id,
        versionNo: v.version.versionNo,
        status: v.version.status,
        mime: v.mime,
        // Prefer HLS when transcoded; fall back to the source MP4 (MVP direct play).
        mediaUrl: await signOrNull(v.r2Key),
        hlsUrl: await signOrNull(v.version.hlsKey),
        thumbUrl: await signOrNull(v.version.thumbKey),
        comments: await listComments(v.version.id),
        approval: approval
          ? { decision: approval.decision, guestName: approval.guestName, createdAt: approval.createdAt }
          : null,
      };
    }),
  );

  return {
    item: { id: item.id, title: item.title },
    canComment: link.canComment,
    latestOnly: link.latestOnly,
    versions: publicVersions,
  };
}
