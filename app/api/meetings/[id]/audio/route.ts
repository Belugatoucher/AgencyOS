import { z } from "zod";
import { eq } from "drizzle-orm";
import { parseBody, respond, withViewer } from "@/lib/api";
import { attachAudio, attachAudioInput, getMeeting } from "@/lib/services/meetings";
import { db } from "@/lib/db";
import { files } from "@/lib/db/schema";
import { r2SignedGetUrl } from "@/lib/r2";
import { err, ok } from "@/lib/result";

type Params = { id: string };
const idSchema = z.string().uuid();

// Finalize: attach the uploaded audio file and start the transcribe pipeline.
export const POST = withViewer<Params>(async (req, viewer, { id }) => {
  const { fileId } = await parseBody(req, attachAudioInput);
  return respond(await attachAudio(viewer, idSchema.parse(id), fileId), 201);
});

// Short-lived signed URL for the synced player (audit item 1: ≤15 min).
export const GET = withViewer<Params>(async (_req, viewer, { id }) => {
  const detail = await getMeeting(viewer, idSchema.parse(id));
  if (!detail.ok) return respond(detail);
  const fileId = detail.value.meeting.audioFileId;
  if (!fileId) return respond(err("not_found", "No audio attached"));
  const [file] = await db.select().from(files).where(eq(files.id, fileId));
  if (!file) return respond(err("not_found", "Audio file missing"));
  let url: string | null = null;
  try {
    url = await r2SignedGetUrl(file.r2Key);
  } catch {
    url = null;
  }
  return respond(ok({ url, mime: file.mime }));
});
