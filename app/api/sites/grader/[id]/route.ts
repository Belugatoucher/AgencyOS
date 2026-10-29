import { z } from "zod";
import { respond, withViewer } from "@/lib/api";
import { deleteReport } from "@/lib/services/grader";

type Params = { id: string };

// Soft delete (rule 8) — also kills the public link.
export const DELETE = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await deleteReport(viewer, z.string().uuid().parse(id)));
});
