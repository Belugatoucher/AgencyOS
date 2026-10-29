import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { decideItem, decideItemInput } from "@/lib/services/ideation";

type Params = { id: string };

// Accept (→ task or goal) / park / dismiss one item.
export const POST = withViewer<Params>(async (req, viewer, { id }) => {
  return respond(await decideItem(viewer, z.string().uuid().parse(id), await parseBody(req, decideItemInput)));
});
