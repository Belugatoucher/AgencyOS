import { parseBody, respond, withViewer } from "@/lib/api";
import { err } from "@/lib/result";
import { createPipeline, listPipelines, pipelineInput } from "@/lib/services/pipelines";

export const GET = withViewer(async (req, viewer) => {
  const account = new URL(req.url).searchParams.get("account");
  if (!account) {
    return respond(err("invalid", "account query param required"));
  }
  return respond(await listPipelines(viewer, account));
});

export const POST = withViewer(async (req, viewer) => {
  const input = await parseBody(req, pipelineInput);
  return respond(await createPipeline(viewer, input), 201);
});
