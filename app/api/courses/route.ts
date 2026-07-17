import { parseBody, respond, withViewer } from "@/lib/api";
import { courseInput, createCourse, listCourses } from "@/lib/services/academy";

// Academy courses (docs/16). Internal only (service guard).

export const GET = withViewer(async (_req, viewer) => {
  return respond(await listCourses(viewer));
});

export const POST = withViewer(async (req, viewer) => {
  const input = await parseBody(req, courseInput);
  return respond(await createCourse(viewer, input), 201);
});
