import { z } from "zod";
import { respond, withViewer } from "@/lib/api";
import { getItem } from "@/lib/services/review";

type Params = { id: string };
const idSchema = z.string().uuid();

export const GET = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await getItem(viewer, idSchema.parse(id)));
});
