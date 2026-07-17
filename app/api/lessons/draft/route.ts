import { parseBody, respond, withViewer } from "@/lib/api";
import { draftInput, draftLessonContent } from "@/lib/services/academy";

// AI lesson/quiz draft (prompts/course-builder.md) — a human edits before publish.
export const POST = withViewer(async (req, viewer) => {
  const input = await parseBody(req, draftInput);
  return respond(await draftLessonContent(viewer, input), 201);
});
