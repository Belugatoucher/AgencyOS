import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { submitQuiz } from "@/lib/services/academy";

type Params = { id: string };
const idSchema = z.string().uuid();
const body = z.object({ answers: z.array(z.number().int().min(0)).min(1).max(7) });

// Quiz attempt: graded server-side; failing returns rewatch evidence (docs/16).
export const POST = withViewer<Params>(async (req, viewer, { id }) => {
  const { answers } = await parseBody(req, body);
  return respond(await submitQuiz(viewer, idSchema.parse(id), answers));
});
