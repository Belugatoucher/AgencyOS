import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { patchComment, patchCommentInput } from "@/lib/services/review";

type Params = { id: string };
const idSchema = z.string().uuid();

export const PATCH = withViewer<Params>(async (req, viewer, { id }) => {
  const input = await parseBody(req, patchCommentInput);
  return respond(await patchComment(viewer, idSchema.parse(id), input));
});
