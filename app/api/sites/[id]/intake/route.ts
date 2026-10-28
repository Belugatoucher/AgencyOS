import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { intakeInput, listSnapshots, startIntake } from "@/lib/services/site-intake";

type Params = { id: string };
const idSchema = z.string().uuid();

export const GET = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await listSnapshots(viewer, idSchema.parse(id)));
});

// Starts a crawl job (rule 4). The URL is SSRF-checked here and again at fetch time.
export const POST = withViewer<Params>(async (req, viewer, { id }) => {
  return respond(await startIntake(viewer, idSchema.parse(id), await parseBody(req, intakeInput)), 202);
});
