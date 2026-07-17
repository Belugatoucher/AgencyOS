import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { addMember, addMemberInput, listMembers } from "@/lib/services/memberships";

type Params = { id: string };
const idSchema = z.string().uuid();

export const GET = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await listMembers(viewer, idSchema.parse(id)));
});

export const POST = withViewer<Params>(async (req, viewer, { id }) => {
  const input = await parseBody(req, addMemberInput);
  return respond(await addMember(viewer, idSchema.parse(id), input), 201);
});
