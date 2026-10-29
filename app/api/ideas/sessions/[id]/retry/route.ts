import { z } from "zod";
import { respond, withViewer } from "@/lib/api";
import { retrySession } from "@/lib/services/ideation";

type Params = { id: string };

export const POST = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await retrySession(viewer, z.string().uuid().parse(id)), 202);
});
