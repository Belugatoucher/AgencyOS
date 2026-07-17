import { z } from "zod";
import { eq } from "drizzle-orm";
import { respond, withViewer } from "@/lib/api";
import { canViewAccount } from "@/lib/access";
import { db } from "@/lib/db";
import { files, reviewItems, reviewVersions } from "@/lib/db/schema";
import { r2SignedGetUrl } from "@/lib/r2";
import { err, ok } from "@/lib/result";

type Params = { id: string };
const idSchema = z.string().uuid();

// Short-lived signed media URLs for the internal player (audit item 1: ≤15 min,
// minted per request, never a permanent object URL).
export const GET = withViewer<Params>(async (_req, viewer, { id }) => {
  const versionId = idSchema.parse(id);
  const [row] = await db
    .select({ version: reviewVersions, item: reviewItems, mime: files.mime, r2Key: files.r2Key })
    .from(reviewVersions)
    .innerJoin(reviewItems, eq(reviewItems.id, reviewVersions.itemId))
    .innerJoin(files, eq(files.id, reviewVersions.fileId))
    .where(eq(reviewVersions.id, versionId));
  if (!row || !canViewAccount(viewer, row.item.accountId)) {
    return respond(err("not_found", "Version not found"));
  }

  async function sign(key: string | null): Promise<string | null> {
    if (!key) return null;
    try {
      return await r2SignedGetUrl(key);
    } catch {
      return null;
    }
  }

  return respond(
    ok({
      mime: row.mime,
      mediaUrl: await sign(row.r2Key),
      hlsUrl: await sign(row.version.hlsKey),
      thumbUrl: await sign(row.version.thumbKey),
      status: row.version.status,
    }),
  );
});
