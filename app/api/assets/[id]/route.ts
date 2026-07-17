import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { updateAsset, updateAssetInput } from "@/lib/services/assets";

type Params = { id: string };
const idSchema = z.string().uuid();

export const PATCH = withViewer<Params>(async (req, viewer, { id }) => {
  const input = await parseBody(req, updateAssetInput);
  return respond(await updateAsset(viewer, idSchema.parse(id), input));
});
