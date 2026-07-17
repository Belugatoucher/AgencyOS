import { z } from "zod";
import { respond, withViewer } from "@/lib/api";
import { getMeeting } from "@/lib/services/meetings";

type Params = { id: string };
const idSchema = z.string().uuid();

export const GET = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await getMeeting(viewer, idSchema.parse(id)));
});
