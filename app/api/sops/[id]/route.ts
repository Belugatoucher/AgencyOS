import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { getSop, sopInput, updateSop } from "@/lib/services/sops";

type Params = { id: string };
const idSchema = z.string().uuid();

export const GET = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await getSop(viewer, idSchema.parse(id)));
});

export const PATCH = withViewer<Params>(async (req, viewer, { id }) => {
  const input = await parseBody(req, sopInput.partial());
  return respond(await updateSop(viewer, idSchema.parse(id), input));
});
