import { parseBody, respond, withViewer } from "@/lib/api";
import { err } from "@/lib/result";
import { createSlot, listSlots, slotInput } from "@/lib/services/content-slots";

export const GET = withViewer(async (req, viewer) => {
  const account = new URL(req.url).searchParams.get("account");
  if (!account) return respond(err("invalid", "account query param required"));
  return respond(await listSlots(viewer, account));
});

export const POST = withViewer(async (req, viewer) => {
  const input = await parseBody(req, slotInput);
  return respond(await createSlot(viewer, input), 201);
});
