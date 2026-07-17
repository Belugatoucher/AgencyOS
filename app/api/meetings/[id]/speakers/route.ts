import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { renameSpeakers } from "@/lib/services/meetings";

type Params = { id: string };
const idSchema = z.string().uuid();
const body = z.object({ speakers: z.record(z.string(), z.string().max(200)) });

export const PATCH = withViewer<Params>(async (req, viewer, { id }) => {
  const { speakers } = await parseBody(req, body);
  return respond(await renameSpeakers(viewer, idSchema.parse(id), speakers));
});
