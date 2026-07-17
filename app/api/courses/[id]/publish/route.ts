import { z } from "zod";
import { respond, withViewer } from "@/lib/api";
import { publishCourse } from "@/lib/services/academy";

type Params = { id: string };
const idSchema = z.string().uuid();

export const POST = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await publishCourse(viewer, idSchema.parse(id)));
});
