import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import {
  accountInput,
  getAccount,
  softDeleteAccount,
  updateAccount,
} from "@/lib/services/accounts";

type Params = { id: string };
const idSchema = z.string().uuid();

export const GET = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await getAccount(viewer, idSchema.parse(id)));
});

export const PATCH = withViewer<Params>(async (req, viewer, { id }) => {
  const input = await parseBody(req, accountInput.partial());
  return respond(await updateAccount(viewer, idSchema.parse(id), input));
});

export const DELETE = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await softDeleteAccount(viewer, idSchema.parse(id)));
});
