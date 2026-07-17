import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { briefInput, generateBrief } from "@/lib/services/brain-chat";

type Params = { accountId: string };
const idSchema = z.string().uuid();

// Content brief via the Brain (docs/08 output shape 7). Same read-only
// tool loop as chat; the brief structure comes from the system prompt.
export const POST = withViewer<Params>(async (req, viewer, { accountId }) => {
  const input = await parseBody(req, briefInput);
  return respond(await generateBrief(viewer, idSchema.parse(accountId), input), 201);
});
