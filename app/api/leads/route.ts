import { parseBody, respond, withViewer } from "@/lib/api";
import { createLead, leadFilters, leadInput, listLeads } from "@/lib/services/leads";

export const GET = withViewer(async (req, viewer) => {
  const url = new URL(req.url);
  const filters = leadFilters.parse({
    pipeline: url.searchParams.get("pipeline") ?? undefined,
    account: url.searchParams.get("account") ?? undefined,
    stage: url.searchParams.get("stage") ?? undefined,
    owner: url.searchParams.get("owner") ?? undefined,
    flag: url.searchParams.get("flag") ?? undefined,
  });
  return respond(await listLeads(viewer, filters));
});

export const POST = withViewer(async (req, viewer) => {
  const input = await parseBody(req, leadInput);
  return respond(await createLead(viewer, input), 201);
});
