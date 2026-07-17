import { parseBody, respond, withViewer } from "@/lib/api";
import { accountInput, createAccount, listAccounts } from "@/lib/services/accounts";
import { postToSlack } from "@/lib/slack";

export const GET = withViewer(async (_req, viewer) => {
  return respond(await listAccounts(viewer));
});

export const POST = withViewer(async (req, viewer) => {
  const input = await parseBody(req, accountInput);
  const result = await createAccount(viewer, input);
  if (result.ok) void postToSlack(`🆕 Account created: *${result.value.name}*`);
  return respond(result, 201);
});
