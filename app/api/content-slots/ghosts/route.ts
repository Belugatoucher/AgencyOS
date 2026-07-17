import { respond, withViewer } from "@/lib/api";
import { err } from "@/lib/result";
import { ghostCards } from "@/lib/services/content-slots";

// Ghost cards for a calendar window (docs/06 "we owe Client X a Thursday post").
export const GET = withViewer(async (req, viewer) => {
  const url = new URL(req.url);
  const account = url.searchParams.get("account");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!account || !from || !to) return respond(err("invalid", "account, from, to required"));
  return respond(await ghostCards(viewer, account, new Date(from), new Date(to)));
});
