import { z } from "zod";
import { respond, withViewer } from "@/lib/api";
import { getUsage } from "@/lib/services/assets";

type Params = { id: string };
const idSchema = z.string().uuid();

export const GET = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await getUsage(viewer, idSchema.parse(id)));
});
