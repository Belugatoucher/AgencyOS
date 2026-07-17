import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { mintReviewShare, mintShareInput } from "@/lib/services/share-links";

type Params = { id: string };
const idSchema = z.string().uuid();

export const POST = withViewer<Params>(async (req, viewer, { id }) => {
  const input = await parseBody(req, mintShareInput);
  return respond(await mintReviewShare(viewer, idSchema.parse(id), input), 201);
});
