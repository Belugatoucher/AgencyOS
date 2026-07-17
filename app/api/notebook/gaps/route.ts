import { respond, withViewer } from "@/lib/api";
import { listGaps } from "@/lib/services/notebook";

// Open Notebook gaps — the "SOPs we're missing" list (docs/16).
export const GET = withViewer(async (_req, viewer) => {
  return respond(await listGaps(viewer));
});
