import { z } from "zod";
import { respond, withViewer } from "@/lib/api";
import { listDeploys } from "@/lib/services/site-ops";

type Params = { id: string };

export const GET = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await listDeploys(viewer, z.string().uuid().parse(id)));
});
