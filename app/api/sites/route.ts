import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { createSite, createSiteInput, sitesOverview } from "@/lib/services/sites";

// Sites (docs/18). Internal-only: the service guard 404s clients.
// Controls: Zod + deepSanitize (parseBody); account scope via siteGuard.

export const GET = withViewer(async (req, viewer) => {
  const account = new URL(req.url).searchParams.get("account");
  return respond(await sitesOverview(viewer, account ? z.string().uuid().parse(account) : undefined));
});

export const POST = withViewer(async (req, viewer) => {
  return respond(await createSite(viewer, await parseBody(req, createSiteInput)), 201);
});
