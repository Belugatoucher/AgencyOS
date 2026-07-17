import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { commitInput, commitIntake } from "@/lib/services/onboarding";

type Params = { id: string };
const idSchema = z.string().uuid();

// Review & commit (docs/10): the member-reviewed payload becomes Brain v1,
// competitors seed research stubs, gaps become tasks, template spawns kickoff.
export const POST = withViewer<Params>(async (req, viewer, { id }) => {
  const input = await parseBody(req, commitInput);
  return respond(await commitIntake(viewer, idSchema.parse(id), input), 201);
});
