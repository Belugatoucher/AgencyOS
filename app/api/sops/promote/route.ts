import { parseBody, respond, withViewer } from "@/lib/api";
import { promoteInput, promoteToSop } from "@/lib/services/sops";

// Promote a meeting's notes or a task description to a draft SOP (docs/16).
export const POST = withViewer(async (req, viewer) => {
  const input = await parseBody(req, promoteInput);
  return respond(await promoteToSop(viewer, input), 201);
});
