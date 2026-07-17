import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { setIntakeToken } from "@/lib/services/pipelines";

type Params = { id: string };
const idSchema = z.string().uuid();
const body = z.object({ enabled: z.boolean() });

// Enable/disable the public intake form for a pipeline (mints/clears a token).
export const POST = withViewer<Params>(async (req, viewer, { id }) => {
  const { enabled } = await parseBody(req, body);
  return respond(await setIntakeToken(viewer, idSchema.parse(id), enabled));
});
