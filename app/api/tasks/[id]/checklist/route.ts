import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { addChecklistItem, checklistItemInput } from "@/lib/services/tasks";

type Params = { id: string };
const idSchema = z.string().uuid();

export const POST = withViewer<Params>(async (req, viewer, { id }) => {
  const input = await parseBody(req, checklistItemInput);
  return respond(await addChecklistItem(viewer, idSchema.parse(id), input), 201);
});
