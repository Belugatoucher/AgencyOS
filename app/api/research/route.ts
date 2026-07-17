import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { createResearch, listResearch, researchInput } from "@/lib/services/research";

// Research library (docs/08). POST enqueues the chunk+embed job — the doc
// returns immediately with status "processing" (jobs, not inline work).

export const GET = withViewer(async (req, viewer) => {
  const account = new URL(req.url).searchParams.get("account");
  const accountId = account ? z.string().uuid().parse(account) : undefined;
  return respond(await listResearch(viewer, accountId));
});

export const POST = withViewer(async (req, viewer) => {
  const input = await parseBody(req, researchInput);
  return respond(await createResearch(viewer, input), 201);
});
