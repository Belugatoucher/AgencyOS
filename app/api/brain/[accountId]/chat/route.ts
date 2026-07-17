import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { askBrain, chatInput, listThreads } from "@/lib/services/brain-chat";

type Params = { accountId: string };
const idSchema = z.string().uuid();

// Ask the Brain (docs/08; audit item 8: read-only tools, Zod-gated inputs,
// retrieval-ID audit trail in ai_threads — all enforced in the service).

export const GET = withViewer<Params>(async (_req, viewer, { accountId }) => {
  return respond(await listThreads(viewer, idSchema.parse(accountId)));
});

export const POST = withViewer<Params>(async (req, viewer, { accountId }) => {
  const input = await parseBody(req, chatInput);
  return respond(await askBrain(viewer, idSchema.parse(accountId), input));
});
