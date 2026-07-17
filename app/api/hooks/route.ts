import { parseBody, respond, withViewer } from "@/lib/api";
import { createHook, hookFilters, hookInput, searchHooks } from "@/lib/services/hooks";

// Hooks library (docs/08). Internal only — the guard lives in the service.

export const GET = withViewer(async (req, viewer) => {
  const url = new URL(req.url);
  const filters = hookFilters.parse({
    format: url.searchParams.get("format") ?? undefined,
    platform: url.searchParams.get("platform") ?? undefined,
    niche: url.searchParams.get("niche") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    account: url.searchParams.get("account") ?? undefined,
  });
  return respond(await searchHooks(viewer, filters));
});

export const POST = withViewer(async (req, viewer) => {
  const input = await parseBody(req, hookInput);
  return respond(await createHook(viewer, input), 201);
});
