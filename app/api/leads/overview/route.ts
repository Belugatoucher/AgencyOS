import { respond, withViewer } from "@/lib/api";
import { overview } from "@/lib/services/leads";

// All-accounts overview (docs/02): every pipeline's totals, stalest, value.
export const GET = withViewer(async (_req, viewer) => {
  return respond(await overview(viewer));
});
