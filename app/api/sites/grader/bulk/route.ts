import { parseBody, respond, withViewer } from "@/lib/api";
import { bulkGradeInput, createBulkReports } from "@/lib/services/grader";

// Grade a prospect list (up to 100). Jobs are spaced out to keep API spend steady.
export const POST = withViewer(async (req, viewer) => {
  return respond(await createBulkReports(viewer, await parseBody(req, bulkGradeInput)), 202);
});
