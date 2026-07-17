import { z } from "zod";
import { respond, withViewer } from "@/lib/api";
import { portalMeetings } from "@/lib/services/portal";

type Params = { accountId: string };
const idSchema = z.string().uuid();

// Shared meeting recaps (docs/11): summary only, never the transcript.
export const GET = withViewer<Params>(async (_req, viewer, { accountId }) => {
  return respond(await portalMeetings(viewer, idSchema.parse(accountId)));
});
