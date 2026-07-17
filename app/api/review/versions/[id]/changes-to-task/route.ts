import { z } from "zod";
import { respond, withViewer } from "@/lib/api";
import { changesToTask } from "@/lib/services/review";

type Params = { id: string };
const idSchema = z.string().uuid();

export const POST = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await changesToTask(viewer, idSchema.parse(id)), 201);
});
