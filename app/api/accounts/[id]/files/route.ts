import { z } from "zod";
import { respond, withViewer } from "@/lib/api";
import { listFiles } from "@/lib/services/files";

type Params = { id: string };
const idSchema = z.string().uuid();

export const GET = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await listFiles(viewer, idSchema.parse(id)));
});
