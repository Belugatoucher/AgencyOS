import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { createMetricSource, listMetricSources, metricSourceInput } from "@/lib/services/metrics";

// Metric sources (docs/09). Internal only (service guard).

export const GET = withViewer(async (req, viewer) => {
  const account = z.string().uuid().parse(new URL(req.url).searchParams.get("account"));
  return respond(await listMetricSources(viewer, account));
});

export const POST = withViewer(async (req, viewer) => {
  const input = await parseBody(req, metricSourceInput);
  return respond(await createMetricSource(viewer, input), 201);
});
