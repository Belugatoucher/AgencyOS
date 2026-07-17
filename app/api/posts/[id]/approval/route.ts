import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { approvalInput, decidePost } from "@/lib/services/posts";

type Params = { id: string };
const idSchema = z.string().uuid();

export const POST = withViewer<Params>(async (req, viewer, { id }) => {
  const input = await parseBody(req, approvalInput);
  return respond(await decidePost(viewer, idSchema.parse(id), input), 201);
});
