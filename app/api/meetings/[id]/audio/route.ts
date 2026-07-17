import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { attachAudio, attachAudioInput } from "@/lib/services/meetings";

type Params = { id: string };
const idSchema = z.string().uuid();

// Finalize: attach the uploaded audio file and start the transcribe pipeline.
export const POST = withViewer<Params>(async (req, viewer, { id }) => {
  const { fileId } = await parseBody(req, attachAudioInput);
  return respond(await attachAudio(viewer, idSchema.parse(id), fileId), 201);
});
