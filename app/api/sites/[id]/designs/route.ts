import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { listDesignSystems, proposeDesign, proposeInput } from "@/lib/services/site-design";

type Params = { id: string };
const idSchema = z.string().uuid();

export const GET = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await listDesignSystems(viewer, idSchema.parse(id)));
});

// Queues an AI proposal (rule 4 + rule 6: prompts/sites-design-system.md).
export const POST = withViewer<Params>(async (req, viewer, { id }) => {
  return respond(await proposeDesign(viewer, idSchema.parse(id), await parseBody(req, proposeInput)), 202);
});
