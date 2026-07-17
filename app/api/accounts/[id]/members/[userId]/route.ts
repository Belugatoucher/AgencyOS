import { z } from "zod";
import { respond, withViewer } from "@/lib/api";
import { removeMember } from "@/lib/services/memberships";

type Params = { id: string; userId: string };
const idSchema = z.string().uuid();

export const DELETE = withViewer<Params>(async (_req, viewer, { id, userId }) => {
  return respond(await removeMember(viewer, idSchema.parse(id), idSchema.parse(userId)));
});
