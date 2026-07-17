import { parseBody, respond, withViewer } from "@/lib/api";
import { createSop, listSops, sopFilters, sopInput } from "@/lib/services/sops";

// SOP library (docs/16). Internal only (service guard).

export const GET = withViewer(async (req, viewer) => {
  const url = new URL(req.url);
  const filters = sopFilters.parse({
    category: url.searchParams.get("category") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    tag: url.searchParams.get("tag") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
  });
  return respond(await listSops(viewer, filters));
});

export const POST = withViewer(async (req, viewer) => {
  const input = await parseBody(req, sopInput);
  return respond(await createSop(viewer, input), 201);
});
