import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { getLead, leadInput, updateLead } from "@/lib/services/leads";

type Params = { id: string };
const idSchema = z.string().uuid();

export const GET = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await getLead(viewer, idSchema.parse(id)));
});

export const PATCH = withViewer<Params>(async (req, viewer, { id }) => {
  const input = await parseBody(req, leadInput.partial());
  return respond(await updateLead(viewer, idSchema.parse(id), input));
});
