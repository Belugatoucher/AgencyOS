import { parseBody, respond, withViewer } from "@/lib/api";
import { presignInput, presignUpload } from "@/lib/services/files";

export const POST = withViewer(async (req, viewer) => {
  const input = await parseBody(req, presignInput);
  return respond(await presignUpload(viewer, input));
});
