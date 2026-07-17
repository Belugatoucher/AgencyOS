import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { tasksFromActionItems, tasksFromInput } from "@/lib/services/meetings";

type Params = { id: string };
const idSchema = z.string().uuid();

// Bulk-create tasks from selected action items (docs/03 action-items → Tasks).
export const POST = withViewer<Params>(async (req, viewer, { id }) => {
  const { indexes } = await parseBody(req, tasksFromInput);
  return respond(await tasksFromActionItems(viewer, idSchema.parse(id), indexes), 201);
});
