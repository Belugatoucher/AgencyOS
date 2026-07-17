import { z } from "zod";
import { respond, withViewer } from "@/lib/api";
import { listSuggestions } from "@/lib/services/brain";

type Params = { accountId: string };
const idSchema = z.string().uuid();

// Pending Brain suggestions (docs/08): the Brain never self-edits silently.
export const GET = withViewer<Params>(async (_req, viewer, { accountId }) => {
  return respond(await listSuggestions(viewer, idSchema.parse(accountId)));
});
