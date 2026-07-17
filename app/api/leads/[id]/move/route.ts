import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { moveLead } from "@/lib/services/leads";

type Params = { id: string };
const idSchema = z.string().uuid();
const body = z.object({ stageUuid: z.string().uuid() });

export const POST = withViewer<Params>(async (req, viewer, { id }) => {
  const { stageUuid } = await parseBody(req, body);
  return respond(await moveLead(viewer, idSchema.parse(id), stageUuid));
});
