import { z } from "zod";
import { respond, withViewer } from "@/lib/api";
import { searchEverything } from "@/lib/services/search";

// Search-everywhere (roadmap wk10). Internal only (service guard).
export const GET = withViewer(async (req, viewer) => {
  const q = z.string().trim().min(1).max(200).parse(new URL(req.url).searchParams.get("q"));
  return respond(await searchEverything(viewer, q));
});
