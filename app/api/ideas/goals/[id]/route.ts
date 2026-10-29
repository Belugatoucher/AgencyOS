import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { deleteGoal, goalPatch, updateGoal } from "@/lib/services/ideation";

type Params = { id: string };
const idSchema = z.string().uuid();

export const PATCH = withViewer<Params>(async (req, viewer, { id }) => {
  return respond(await updateGoal(viewer, idSchema.parse(id), await parseBody(req, goalPatch)));
});

// Soft delete (rule 8).
export const DELETE = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await deleteGoal(viewer, idSchema.parse(id)));
});
