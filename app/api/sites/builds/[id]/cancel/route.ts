import { z } from "zod";
import { respond, withViewer } from "@/lib/api";
import { cancelBuild } from "@/lib/services/site-builds";

type Params = { id: string };

export const POST = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await cancelBuild(viewer, z.string().uuid().parse(id)));
});
