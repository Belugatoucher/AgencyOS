import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { decideSuggestion } from "@/lib/services/brain";

type Params = { id: string };
const idSchema = z.string().uuid();
const body = z.object({ decision: z.enum(["accepted", "rejected"]) });

// Accept/reject a pending Brain suggestion (docs/08 human gate).
export const POST = withViewer<Params>(async (req, viewer, { id }) => {
  const { decision } = await parseBody(req, body);
  return respond(await decideSuggestion(viewer, idSchema.parse(id), decision));
});
