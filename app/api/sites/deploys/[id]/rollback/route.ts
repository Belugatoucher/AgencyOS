import { z } from "zod";
import { respond, withViewer } from "@/lib/api";
import { rollbackTo } from "@/lib/services/site-ops";

type Params = { id: string };

// Restores production to this earlier ready production deploy.
export const POST = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await rollbackTo(viewer, z.string().uuid().parse(id)), 201);
});
