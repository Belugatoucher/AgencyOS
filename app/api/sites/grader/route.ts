import { parseBody, respond, withViewer } from "@/lib/api";
import { ok } from "@/lib/result";
import { createInternalReport, graderCapabilities, internalGradeInput, listReports, reportListQuery } from "@/lib/services/grader";

// Internal grader console (docs/18 "Grader"). Internal-only: the service 404s clients.

export const GET = withViewer(async (req, viewer) => {
  const q = reportListQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  const list = await listReports(viewer, q);
  if (!list.ok) return respond(list);
  return respond(ok({ reports: list.value, capabilities: graderCapabilities() }));
});

export const POST = withViewer(async (req, viewer) => {
  return respond(await createInternalReport(viewer, await parseBody(req, internalGradeInput)), 202);
});
