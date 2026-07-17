import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FFMPEG, hlsLadder, imageThumbnail, mediaKind, spriteSheet, videoThumbnail } from "./ffmpeg";

const run = promisify(execFile);
let dir: string;
// A "full" ffmpeg (with the mjpeg + h264 encoders and lavfi) is required to
// exercise the processing wrappers. The minimal Playwright-bundled build in
// some CI/dev environments lacks them; the worker's Docker image installs a
// full ffmpeg (see Dockerfile.worker). When only a minimal build is present,
// the encode/transcode assertions skip so the suite stays green — mediaKind
// (pure logic) always runs.
let fullFfmpeg = false;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ffmpeg-test-"));
  try {
    const { stdout } = await run(FFMPEG, ["-hide_banner", "-encoders"]);
    fullFfmpeg = /mjpeg/.test(stdout) && /libx264|\bh264\b/.test(stdout);
    const { stdout: fmts } = await run(FFMPEG, ["-hide_banner", "-formats"]);
    fullFfmpeg = fullFfmpeg && /lavfi/.test(fmts);
  } catch {
    fullFfmpeg = false;
  }
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("mediaKind", () => {
  it("classifies by mime prefix", () => {
    expect(mediaKind("image/png")).toBe("image");
    expect(mediaKind("video/mp4")).toBe("video");
    expect(mediaKind("audio/mpeg")).toBe("audio");
    expect(mediaKind("application/pdf")).toBe("other");
  });
});

describe("ffmpeg wrappers", () => {
  it("makes an image thumbnail", async () => {
    if (!fullFfmpeg) return;
    const src = path.join(dir, "src.png");
    const out = path.join(dir, "thumb.jpg");
    // synthesize a test image
    await run(FFMPEG, ["-y", "-f", "lavfi", "-i", "color=c=red:s=1200x800", "-frames:v", "1", src]);
    await imageThumbnail(src, out, 320);
    expect((await stat(out)).size).toBeGreaterThan(0);
  });

  it("makes a video thumbnail and sprite sheet and HLS ladder", async () => {
    if (!fullFfmpeg) return;
    const src = path.join(dir, "clip.mp4");
    // 3s test pattern with a tone
    await run(FFMPEG, [
      "-y", "-f", "lavfi", "-i", "testsrc=d=3:s=640x360:r=15",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
      "-c:v", "libx264", "-c:a", "aac", "-shortest", "-pix_fmt", "yuv420p", src,
    ]);

    const thumb = path.join(dir, "vthumb.jpg");
    await videoThumbnail(src, thumb, 320);
    expect((await stat(thumb)).size).toBeGreaterThan(0);

    const sprite = path.join(dir, "sprite.jpg");
    const meta = await spriteSheet(src, sprite, { everySec: 1, tileW: 80, cols: 4 });
    expect(meta.everySec).toBe(1);
    expect((await stat(sprite)).size).toBeGreaterThan(0);

    const hlsDir = path.join(dir, "hls");
    await import("node:fs/promises").then((fs) => fs.mkdir(hlsDir, { recursive: true }));
    await hlsLadder(src, hlsDir);
    expect((await stat(path.join(hlsDir, "master.m3u8"))).size).toBeGreaterThan(0);
  }, 60_000);
});
