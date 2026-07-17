import { parseBody, respond, withViewer } from "@/lib/api";
import { err } from "@/lib/result";
import { createItem, itemInput, listItems } from "@/lib/services/review";

export const GET = withViewer(async (req, viewer) => {
  const account = new URL(req.url).searchParams.get("account");
  if (!account) return respond(err("invalid", "account query param required"));
  return respond(await listItems(viewer, account));
});

export const POST = withViewer(async (req, viewer) => {
  const input = await parseBody(req, itemInput);
  return respond(await createItem(viewer, input), 201);
});
