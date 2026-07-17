import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// FFMPEG_PATH lets prod point at an apt-installed ffmpeg; in this environment
// the Playwright-bundled build works. Dockerfile.worker installs ffmpeg itself.
export const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
export const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";

// Input caps (audit item 7): ffmpeg runs isolated in the worker container, and
// we bound work with a hard timeout so a crafted file can't hang the queue.
const FFMPEG_TIMEOUT_MS = 10 * 60 * 1000;

async function ffmpeg(args: string[]): Promise<void> {
  await run(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", ...args], {
    timeout: FFMPEG_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Single thumbnail from an image, scaled to fit a box, as JPEG. */
export async function imageThumbnail(input: string, output: string, box = 640): Promise<void> {
  await ffmpeg([
    "-i", input,
    "-vf", `scale='min(${box},iw)':'min(${box},ih)':force_original_aspect_ratio=decrease`,
    "-frames:v", "1",
    output,
  ]);
}

/** A single poster frame from a video (grabbed a second in), as JPEG. */
export async function videoThumbnail(input: string, output: string, box = 640): Promise<void> {
  await ffmpeg([
    "-ss", "1",
    "-i", input,
    "-vf", `scale='min(${box},iw)':'min(${box},ih)':force_original_aspect_ratio=decrease`,
    "-frames:v", "1",
    output,
  ]);
}

/**
 * A scrubbing sprite sheet: one small frame every `everySec` seconds, tiled
 * into a grid. Returns the tile count and grid columns so the player can map a
 * timestamp to a tile. (Review scrub preview, docs/01.)
 */
export async function spriteSheet(
  input: string,
  output: string,
  opts: { everySec?: number; tileW?: number; cols?: number } = {},
): Promise<{ cols: number; tileW: number; everySec: number }> {
  const everySec = opts.everySec ?? 5;
  const tileW = opts.tileW ?? 160;
  const cols = opts.cols ?? 10;
  await ffmpeg([
    "-i", input,
    "-vf", `fps=1/${everySec},scale=${tileW}:-1,tile=${cols}x${cols}`,
    "-frames:v", "1",
    output,
  ]);
  return { cols, tileW, everySec };
}

/**
 * Transcode to an HLS ladder (720p + 1080p) with a master playlist. Writes into
 * outDir: master.m3u8 + per-rendition playlists and segments. (docs/01)
 */
export async function hlsLadder(input: string, outDir: string): Promise<void> {
  // Two renditions; the source is scaled down (never up) to each height.
  await ffmpeg([
    "-i", input,
    "-filter_complex",
    "[0:v]split=2[v1][v2];" +
      "[v1]scale=-2:'min(720,ih)'[v720];" +
      "[v2]scale=-2:'min(1080,ih)'[v1080]",
    "-map", "[v720]", "-map", "0:a?",
    "-map", "[v1080]", "-map", "0:a?",
    "-c:v", "h264", "-c:a", "aac",
    "-var_stream_map", "v:0,a:0 v:1,a:1",
    "-master_pl_name", "master.m3u8",
    "-f", "hls",
    "-hls_time", "6",
    "-hls_playlist_type", "vod",
    "-hls_segment_filename", `${outDir}/stream_%v_%03d.ts`,
    `${outDir}/stream_%v.m3u8`,
  ]);
}

/** Media class from a mime type — drives which processing runs. */
export function mediaKind(mime: string): "image" | "video" | "audio" | "other" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "other";
}
