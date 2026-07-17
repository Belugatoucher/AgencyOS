import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { resolveGap } from "@/lib/services/notebook";

type Params = { id: string };
const idSchema = z.string().uuid();
const body = z.object({ sopId: z.string().uuid() });

// Close the loop: a gap resolves by pointing at the SOP that now answers it.
export const POST = withViewer<Params>(async (req, viewer, { id }) => {
  const { sopId } = await parseBody(req, body);
  return respond(await resolveGap(viewer, idSchema.parse(id), sopId));
});
