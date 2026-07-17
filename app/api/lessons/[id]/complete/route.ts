import { z } from "zod";
import { respond, withViewer } from "@/lib/api";
import { completeLesson } from "@/lib/services/academy";

type Params = { id: string };
const idSchema = z.string().uuid();

// "Mark understood" for video/sop/doc lessons; quiz lessons complete by passing.
export const POST = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await completeLesson(viewer, idSchema.parse(id)));
});
