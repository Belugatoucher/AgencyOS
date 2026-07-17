import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { addComment, commentInput } from "@/lib/services/task-comments";

type Params = { id: string };
const idSchema = z.string().uuid();

export const POST = withViewer<Params>(async (req, viewer, { id }) => {
  const input = await parseBody(req, commentInput);
  return respond(await addComment(viewer, idSchema.parse(id), input), 201);
});
