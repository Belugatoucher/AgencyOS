import { z } from "zod";
import { respond, withViewer } from "@/lib/api";
import { rerunReport } from "@/lib/services/grader";

type Params = { id: string };

// Re-grade (after the prospect fixes things, or after a failure). Same link.
export const POST = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await rerunReport(viewer, z.string().uuid().parse(id)), 202);
});
