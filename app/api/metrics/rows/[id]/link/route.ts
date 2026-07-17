import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { linkMetricRow } from "@/lib/services/metrics";

type Params = { id: string };
const idSchema = z.string().uuid();
const body = z.object({ creativeId: z.string().uuid().nullable() });

// Manual ad↔creative link (docs/09): null unlinks.
export const POST = withViewer<Params>(async (req, viewer, { id }) => {
  const { creativeId } = await parseBody(req, body);
  return respond(await linkMetricRow(viewer, idSchema.parse(id), creativeId));
});
