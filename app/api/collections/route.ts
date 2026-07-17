import { parseBody, respond, withViewer } from "@/lib/api";
import { err } from "@/lib/result";
import { collectionInput, createCollection, listCollections } from "@/lib/services/collections";

export const GET = withViewer(async (req, viewer) => {
  const account = new URL(req.url).searchParams.get("account");
  if (!account) return respond(err("invalid", "account query param required"));
  return respond(await listCollections(viewer, account));
});

export const POST = withViewer(async (req, viewer) => {
  const input = await parseBody(req, collectionInput);
  return respond(await createCollection(viewer, input), 201);
});
