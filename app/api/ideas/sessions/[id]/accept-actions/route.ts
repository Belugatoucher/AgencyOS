import { z } from "zod";
import { respond, withViewer } from "@/lib/api";
import { acceptAllActions } from "@/lib/services/ideation";

type Params = { id: string };

// Every proposed on-strategy action → a task. Off-strategy items stay for a deliberate call.
export const POST = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await acceptAllActions(viewer, z.string().uuid().parse(id)));
});
