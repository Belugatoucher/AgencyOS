import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { toggleChecklistItem } from "@/lib/services/tasks";

type Params = { id: string; itemId: string };
const idSchema = z.string().uuid();
const body = z.object({ done: z.boolean() });

export const PATCH = withViewer<Params>(async (req, viewer, { id, itemId }) => {
  const { done } = await parseBody(req, body);
  return respond(await toggleChecklistItem(viewer, idSchema.parse(id), idSchema.parse(itemId), done));
});
