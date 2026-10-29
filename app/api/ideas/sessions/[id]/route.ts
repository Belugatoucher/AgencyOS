import { z } from "zod";
import { respond, withViewer } from "@/lib/api";
import { deleteSession, getSession } from "@/lib/services/ideation";

type Params = { id: string };
const idSchema = z.string().uuid();

export const GET = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await getSession(viewer, idSchema.parse(id)));
});

export const DELETE = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await deleteSession(viewer, idSchema.parse(id)));
});
