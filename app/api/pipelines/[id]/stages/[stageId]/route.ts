import { z } from "zod";
import { respond, withViewer } from "@/lib/api";
import { deleteStage } from "@/lib/services/pipelines";

type Params = { id: string; stageId: string };
const idSchema = z.string().uuid();

export const DELETE = withViewer<Params>(async (_req, viewer, { id, stageId }) => {
  return respond(await deleteStage(viewer, idSchema.parse(id), idSchema.parse(stageId)));
});
