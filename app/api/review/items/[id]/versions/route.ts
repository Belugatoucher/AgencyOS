import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { addVersion, versionInput } from "@/lib/services/review";

type Params = { id: string };
const idSchema = z.string().uuid();

export const POST = withViewer<Params>(async (req, viewer, { id }) => {
  const input = await parseBody(req, versionInput);
  return respond(await addVersion(viewer, idSchema.parse(id), input), 201);
});
