import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { getTask, updateTask, updateTaskInput } from "@/lib/services/tasks";

type Params = { id: string };
const idSchema = z.string().uuid();

export const GET = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await getTask(viewer, idSchema.parse(id)));
});

export const PATCH = withViewer<Params>(async (req, viewer, { id }) => {
  const input = await parseBody(req, updateTaskInput);
  return respond(await updateTask(viewer, idSchema.parse(id), input));
});
