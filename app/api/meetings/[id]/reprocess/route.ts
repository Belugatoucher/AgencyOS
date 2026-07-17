import { z } from "zod";
import { respond, withViewer } from "@/lib/api";
import { reprocess } from "@/lib/services/meetings";

type Params = { id: string };
const idSchema = z.string().uuid();

export const POST = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await reprocess(viewer, idSchema.parse(id)), 202);
});
