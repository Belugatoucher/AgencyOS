import { parseBody, respond, withViewer } from "@/lib/api";
import { assignmentInput, createAssignment } from "@/lib/services/academy";

// Assignment rules (docs/16): roles auto-assign, user_ids manual; fires
// immediately for current holders and on future user creation.
export const POST = withViewer(async (req, viewer) => {
  const input = await parseBody(req, assignmentInput);
  return respond(await createAssignment(viewer, input), 201);
});
