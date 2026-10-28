import { z } from "zod";
import { respond, withViewer } from "@/lib/api";
import { requestHealthRun, siteHealth } from "@/lib/services/site-ops";

type Params = { id: string };
const idSchema = z.string().uuid();

export const GET = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await siteHealth(viewer, idSchema.parse(id)));
});

// "Run checks now" — enqueues; probes run in the worker (rule 4).
export const POST = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await requestHealthRun(viewer, idSchema.parse(id)), 202);
});
