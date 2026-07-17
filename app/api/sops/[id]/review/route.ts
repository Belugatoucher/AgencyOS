import { z } from "zod";
import { respond, withViewer } from "@/lib/api";
import { markReviewed } from "@/lib/services/sops";

type Params = { id: string };
const idSchema = z.string().uuid();

// "Still accurate" — clears needs_review, restarts the staleness clock.
export const POST = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await markReviewed(viewer, idSchema.parse(id)));
});
