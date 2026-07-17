import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { courseUpdateInput, getCourse, updateCourse } from "@/lib/services/academy";

type Params = { id: string };
const idSchema = z.string().uuid();

export const GET = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await getCourse(viewer, idSchema.parse(id)));
});

// Price/access/metadata edits (db/009). Internal only (service guard).
export const PATCH = withViewer<Params>(async (req, viewer, { id }) => {
  const input = await parseBody(req, courseUpdateInput);
  return respond(await updateCourse(viewer, idSchema.parse(id), input));
});
