import { z } from "zod";
import { respond, withViewer } from "@/lib/api";
import { publishSop } from "@/lib/services/sops";

type Params = { id: string };
const idSchema = z.string().uuid();

// Publish: snapshot version + enqueue chunk-on-publish (docs/16).
export const POST = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await publishSop(viewer, idSchema.parse(id)));
});
