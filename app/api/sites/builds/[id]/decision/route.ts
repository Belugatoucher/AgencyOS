import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { decideBuild, decideBuildInput } from "@/lib/services/site-builds";

type Params = { id: string };

// Approval gate 2 (docs/18): approve → production deploy job; nothing else reaches production.
export const POST = withViewer<Params>(async (req, viewer, { id }) => {
  return respond(await decideBuild(viewer, z.string().uuid().parse(id), await parseBody(req, decideBuildInput)));
});
