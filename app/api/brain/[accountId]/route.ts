import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { brainInput, getBrain, updateBrain } from "@/lib/services/brain";

type Params = { accountId: string };
const idSchema = z.string().uuid();

// Client Brain (docs/08). Internal only; every PATCH snapshots to brain_versions.

export const GET = withViewer<Params>(async (_req, viewer, { accountId }) => {
  return respond(await getBrain(viewer, idSchema.parse(accountId)));
});

export const PATCH = withViewer<Params>(async (req, viewer, { accountId }) => {
  const input = await parseBody(req, brainInput);
  return respond(await updateBrain(viewer, idSchema.parse(accountId), input));
});
