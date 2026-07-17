import { z } from "zod";
import { respond, withViewer } from "@/lib/api";
import { listUnmatched } from "@/lib/services/metrics";

// Unmatched ad rows for the manual-link UI (docs/09).
export const GET = withViewer(async (req, viewer) => {
  const account = z.string().uuid().parse(new URL(req.url).searchParams.get("account"));
  return respond(await listUnmatched(viewer, account));
});
