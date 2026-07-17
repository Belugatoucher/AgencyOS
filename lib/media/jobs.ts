import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { assets, files, lessons, reviewVersions } from "@/lib/db/schema";
import { r2GetToFile, r2PutFile } from "@/lib/r2";
import { getQueue } from "@/lib/queues";
import { hlsLadder, imageThumbnail, mediaKind, spriteSheet, videoThumbnail } from "./ffmpeg";

// Media keys live alongside the source object under a derived namespace.
function derivedKey(sourceKey: string, suffix: string): string {
  const dir = sourceKey.split("/").slice(0, -1).join("/");
  return `${dir}/derived/${suffix}`;
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "agencyos-media-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Thumbnail an asset (image or video) and set its thumb_key. Enqueued when an
 * asset is registered (docs/05).
 */
export async function processAssetThumbnail(assetId: string): Promise<{ thumbKey: string | null }> {
  const [asset] = await db.select().from(assets).where(eq(assets.id, assetId));
  if (!asset) throw new Error(`Asset ${assetId} not found`);
  const [file] = await db.select().from(files).where(eq(files.id, asset.fileId));
  if (!file) throw new Error(`File for asset ${assetId} not found`);

  const kind = mediaKind(file.mime);
  if (kind !== "image" && kind !== "video") return { thumbKey: null };

  const thumbKey = derivedKey(file.r2Key, "thumb.jpg");
  await withTempDir(async (dir) => {
    const src = path.join(dir, "src");
    const out = path.join(dir, "thumb.jpg");
    await r2GetToFile(file.r2Key, src);
    if (kind === "image") await imageThumbnail(src, out);
    else await videoThumbnail(src, out);
    await r2PutFile(thumbKey, out, "image/jpeg");
  });

  await db.update(assets).set({ thumbKey }).where(eq(assets.id, assetId));
  return { thumbKey };
}

/**
 * Transcode a review version: poster thumbnail + scrub sprite + HLS ladder for
 * video; poster only for images. Sets thumb_key/sprite_key/hls_key and marks
 * the version ready|failed (docs/01).
 */
export async function processReviewVersion(versionId: string): Promise<{ status: string }> {
  const [version] = await db.select().from(reviewVersions).where(eq(reviewVersions.id, versionId));
  if (!version) throw new Error(`Review version ${versionId} not found`);
  const [file] = await db.select().from(files).where(eq(files.id, version.fileId));
  if (!file) throw new Error(`File for version ${versionId} not found`);

  const kind = mediaKind(file.mime);
  const thumbKey = derivedKey(file.r2Key, `v${version.versionNo}/thumb.jpg`);
  const spriteKey = derivedKey(file.r2Key, `v${version.versionNo}/sprite.jpg`);
  const hlsDirKey = derivedKey(file.r2Key, `v${version.versionNo}/hls`);

  try {
    await withTempDir(async (dir) => {
      const src = path.join(dir, "src");
      await r2GetToFile(file.r2Key, src);

      if (kind === "image") {
        const out = path.join(dir, "thumb.jpg");
        await imageThumbnail(src, out, 1280);
        await r2PutFile(thumbKey, out, "image/jpeg");
        await db.update(reviewVersions).set({ thumbKey, status: "ready" }).where(eq(reviewVersions.id, versionId));
        return;
      }

      if (kind === "video") {
        const thumb = path.join(dir, "thumb.jpg");
        const sprite = path.join(dir, "sprite.jpg");
        const hlsDir = path.join(dir, "hls");
        await import("node:fs/promises").then((fs) => fs.mkdir(hlsDir, { recursive: true }));

        await videoThumbnail(src, thumb, 1280);
        await r2PutFile(thumbKey, thumb, "image/jpeg");
        await spriteSheet(src, sprite);
        await r2PutFile(spriteKey, sprite, "image/jpeg");
        await hlsLadder(src, hlsDir);
        // upload every HLS artifact under the hls key prefix
        for (const name of await readdir(hlsDir)) {
          const ct = name.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t";
          await r2PutFile(`${hlsDirKey}/${name}`, path.join(hlsDir, name), ct);
        }
        await db
          .update(reviewVersions)
          .set({ thumbKey, spriteKey, hlsKey: `${hlsDirKey}/master.m3u8`, status: "ready" })
          .where(eq(reviewVersions.id, versionId));
        return;
      }

      // audio/other: no transcode, mark ready so the item is usable
      await db.update(reviewVersions).set({ status: "ready" }).where(eq(reviewVersions.id, versionId));
    });
    return { status: "ready" };
  } catch (e) {
    await db.update(reviewVersions).set({ status: "failed" }).where(eq(reviewVersions.id, versionId));
    throw e;
  }
}

/**
 * Lesson video (docs/16 reuse map): HLS ladder via the same ffmpeg rail as
 * Review, then hand off to the whisper worker for the transcript.
 */
export async function processLessonMedia(lessonId: string): Promise<{ status: string }> {
  const [lesson] = await db.select().from(lessons).where(eq(lessons.id, lessonId));
  if (!lesson) throw new Error(`Lesson ${lessonId} not found`);
  if (!lesson.videoFileId) throw new Error(`Lesson ${lessonId} has no video`);
  const [file] = await db.select().from(files).where(eq(files.id, lesson.videoFileId));
  if (!file) throw new Error(`File for lesson ${lessonId} not found`);
  if (mediaKind(file.mime) !== "video") throw new Error(`Lesson ${lessonId} file is not video`);

  const hlsDirKey = derivedKey(file.r2Key, `lesson/${lessonId}/hls`);
  await withTempDir(async (dir) => {
    const src = path.join(dir, "src");
    await r2GetToFile(file.r2Key, src);
    const hlsDir = path.join(dir, "hls");
    await import("node:fs/promises").then((fs) => fs.mkdir(hlsDir, { recursive: true }));
    await hlsLadder(src, hlsDir);
    for (const name of await readdir(hlsDir)) {
      const ct = name.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t";
      await r2PutFile(`${hlsDirKey}/${name}`, path.join(hlsDir, name), ct);
    }
  });
  await db.update(lessons).set({ hlsKey: `${hlsDirKey}/master.m3u8` }).where(eq(lessons.id, lessonId));
  await getQueue("transcribe").add("transcribe-lesson", { lessonId });
  return { status: "ready" };
}
