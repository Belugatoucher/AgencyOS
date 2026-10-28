import { z } from "zod";
import { respond, withViewer } from "@/lib/api";
import { analyticsQuery, siteAnalytics } from "@/lib/services/site-ops";

type Params = { id: string };

export const GET = withViewer<Params>(async (req, viewer, { id }) => {
  const { days } = analyticsQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  return respond(await siteAnalytics(viewer, z.string().uuid().parse(id), days));
});
