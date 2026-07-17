import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { getPost, updatePost, updatePostInput } from "@/lib/services/posts";

type Params = { id: string };
const idSchema = z.string().uuid();

export const GET = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await getPost(viewer, idSchema.parse(id)));
});

export const PATCH = withViewer<Params>(async (req, viewer, { id }) => {
  const input = await parseBody(req, updatePostInput);
  return respond(await updatePost(viewer, idSchema.parse(id), input));
});
