import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { decideDesign, decideDesignInput } from "@/lib/services/site-design";

type Params = { id: string };

// Approval gate 1 (docs/18): only a person moves a design to approved/rejected.
export const POST = withViewer<Params>(async (req, viewer, { id }) => {
  return respond(await decideDesign(viewer, z.string().uuid().parse(id), await parseBody(req, decideDesignInput)));
});
