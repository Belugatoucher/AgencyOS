import { parseBody, respond, withViewer } from "@/lib/api";
import { createLesson, lessonInput } from "@/lib/services/academy";

// Lessons (docs/16): video lessons enqueue HLS + whisper on the existing rails.
export const POST = withViewer(async (req, viewer) => {
  const input = await parseBody(req, lessonInput);
  return respond(await createLesson(viewer, input), 201);
});
