import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { shareCollection, shareInput } from "@/lib/services/collections";

type Params = { id: string };
const idSchema = z.string().uuid();

export const POST = withViewer<Params>(async (req, viewer, { id }) => {
  const input = await parseBody(req, shareInput);
  return respond(await shareCollection(viewer, idSchema.parse(id), input), 201);
});
