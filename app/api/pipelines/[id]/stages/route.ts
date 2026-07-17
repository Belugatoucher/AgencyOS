import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { addStage, stageInput } from "@/lib/services/pipelines";

type Params = { id: string };
const idSchema = z.string().uuid();

export const POST = withViewer<Params>(async (req, viewer, { id }) => {
  const input = await parseBody(req, stageInput);
  return respond(await addStage(viewer, idSchema.parse(id), input), 201);
});
