import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { listBuilds, requestBuild, requestBuildInput } from "@/lib/services/site-builds";

type Params = { id: string };
const idSchema = z.string().uuid();

export const GET = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await listBuilds(viewer, idSchema.parse(id)));
});

export const POST = withViewer<Params>(async (req, viewer, { id }) => {
  return respond(await requestBuild(viewer, idSchema.parse(id), await parseBody(req, requestBuildInput)), 202);
});
