import { z } from "zod";
import { respond, withViewer } from "@/lib/api";
import { getSnapshot } from "@/lib/services/site-intake";

type Params = { id: string };

// Full snapshot (page inventory) — the list route returns summaries only.
export const GET = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await getSnapshot(viewer, z.string().uuid().parse(id)));
});
