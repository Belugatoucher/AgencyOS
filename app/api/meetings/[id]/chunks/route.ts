import { z } from "zod";
import { respond, withViewer } from "@/lib/api";
import { err, ok } from "@/lib/result";
import { getMeeting } from "@/lib/services/meetings";
import { presignUpload } from "@/lib/services/files";

type Params = { id: string };
const idSchema = z.string().uuid();
const body = z.object({ index: z.number().int().min(0), sizeBytes: z.number().int().positive().max(50 * 1024 * 1024) });

// In-person recorder durability (docs/03): mint a presigned PUT for each 30s
// chunk so a dead battery loses nothing. Chunks land under the meeting's key
// prefix; the recorder still uploads the full recording on stop → /audio.
export const POST = withViewer<Params>(async (req, viewer, { id }) => {
  const meetingId = idSchema.parse(id);
  const detail = await getMeeting(viewer, meetingId);
  if (!detail.ok) return respond(detail);
  if (!detail.value.meeting.accountId) return respond(err("invalid", "Meeting has no account for chunk storage"));
  const { index, sizeBytes } = body.parse(await req.json());

  const presign = await presignUpload(viewer, {
    accountId: detail.value.meeting.accountId,
    filename: `chunk-${String(index).padStart(4, "0")}.webm`,
    mime: "audio/webm",
    sizeBytes,
  });
  if (!presign.ok) return respond(presign);
  return respond(ok({ url: presign.value.mode === "single" ? presign.value.url : null, key: presign.value.key }), 201);
});
