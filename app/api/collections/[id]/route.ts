import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { addAssetToCollection, getCollection } from "@/lib/services/collections";

type Params = { id: string };
const idSchema = z.string().uuid();
const addBody = z.object({ assetId: z.string().uuid() });

export const GET = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await getCollection(viewer, idSchema.parse(id)));
});

export const POST = withViewer<Params>(async (req, viewer, { id }) => {
  const { assetId } = await parseBody(req, addBody);
  return respond(await addAssetToCollection(viewer, idSchema.parse(id), assetId), 201);
});
