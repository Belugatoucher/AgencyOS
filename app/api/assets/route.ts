import { parseBody, respond, withViewer } from "@/lib/api";
import { assetFilters, listAssets, registerAsset, registerAssetInput } from "@/lib/services/assets";

export const GET = withViewer(async (req, viewer) => {
  const url = new URL(req.url);
  const filters = assetFilters.parse({
    account: url.searchParams.get("account") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    tag: url.searchParams.get("tag") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
  });
  return respond(await listAssets(viewer, filters));
});

export const POST = withViewer(async (req, viewer) => {
  const input = await parseBody(req, registerAssetInput);
  return respond(await registerAsset(viewer, input), 201);
});
