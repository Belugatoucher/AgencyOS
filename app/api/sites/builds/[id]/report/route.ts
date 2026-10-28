import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { buildOutcomeInput, reportBuild } from "@/lib/services/site-builds";

type Params = { id: string };

// Manual runner: a person reports the agent's result (preview URL, branch, summary).
export const POST = withViewer<Params>(async (req, viewer, { id }) => {
  return respond(await reportBuild(viewer, z.string().uuid().parse(id), await parseBody(req, buildOutcomeInput)));
});
