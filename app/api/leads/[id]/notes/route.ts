import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { addNote, noteInput } from "@/lib/services/leads";

type Params = { id: string };
const idSchema = z.string().uuid();

export const POST = withViewer<Params>(async (req, viewer, { id }) => {
  const input = await parseBody(req, noteInput);
  return respond(await addNote(viewer, idSchema.parse(id), input), 201);
});
