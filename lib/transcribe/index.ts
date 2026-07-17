import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { files, meetings, transcripts } from "@/lib/db/schema";
import { r2GetToFile } from "@/lib/r2";
import { getQueue } from "@/lib/queues";

const run = promisify(execFile);

// The transcription + diarization runs a Python worker (faster-whisper large-v3
// int8 + pyannote) shipped at scripts/transcribe.py. TRANSCRIBE_CMD overrides
// the interpreter/script; the worker Docker image installs the Python deps.
// Audio never leaves our infra — only the resulting text goes to Claude (docs/03).
const TRANSCRIBE_CMD = process.env.TRANSCRIBE_CMD ?? "python3";
const TRANSCRIBE_SCRIPT = process.env.TRANSCRIBE_SCRIPT ?? path.join(process.cwd(), "scripts", "transcribe.py");
const TRANSCRIBE_TIMEOUT_MS = 30 * 60 * 1000;

export type Segment = { start_ms: number; end_ms: number; speaker: string; text: string };

/**
 * Transcribe a meeting's audio into diarized segments and persist them, then
 * enqueue the Claude notes job. Called by the `transcribe` queue worker.
 */
export async function transcribeMeeting(meetingId: string): Promise<{ segments: number }> {
  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
  if (!meeting) throw new Error(`Meeting ${meetingId} not found`);
  if (!meeting.audioFileId) throw new Error(`Meeting ${meetingId} has no audio`);
  const [file] = await db.select().from(files).where(eq(files.id, meeting.audioFileId));
  if (!file) throw new Error(`Audio file for ${meetingId} not found`);

  const dir = await mkdtemp(path.join(tmpdir(), "agencyos-tx-"));
  try {
    const src = path.join(dir, "audio");
    const outJson = path.join(dir, "out.json");
    await r2GetToFile(file.r2Key, src);

    // The script writes {segments:[{start_ms,end_ms,speaker,text}], speakers:{}} to outJson.
    await run(TRANSCRIBE_CMD, [TRANSCRIBE_SCRIPT, "--input", src, "--output", outJson], {
      timeout: TRANSCRIBE_TIMEOUT_MS,
      maxBuffer: 128 * 1024 * 1024,
    });
    const parsed = JSON.parse(await readFile(outJson, "utf8")) as {
      segments: Segment[];
      speakers?: Record<string, string>;
    };

    await db
      .insert(transcripts)
      .values({ meetingId, segments: parsed.segments, speakers: parsed.speakers ?? {} })
      .onConflictDoUpdate({
        target: transcripts.meetingId,
        set: { segments: parsed.segments, speakers: parsed.speakers ?? {} },
      });
    await db.update(meetings).set({ status: "summarizing" }).where(eq(meetings.id, meetingId));

    // Hand off to the AI notes job (audio stays on-box; only text goes onward).
    await getQueue("ai").add("meeting-notes", { meetingId });
    return { segments: parsed.segments.length };
  } catch (e) {
    await db.update(meetings).set({ status: "failed" }).where(eq(meetings.id, meetingId));
    throw e;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
