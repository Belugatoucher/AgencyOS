import { z } from "zod";
import { respond, withViewer } from "@/lib/api";
import { getCourse } from "@/lib/services/academy";

type Params = { id: string };
const idSchema = z.string().uuid();

export const GET = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await getCourse(viewer, idSchema.parse(id)));
});
