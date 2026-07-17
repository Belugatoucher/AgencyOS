import { respond, withViewer } from "@/lib/api";
import { listMyDiyCourses } from "@/lib/services/diy";

// The DIY learner's shelf (db/008): entitled paid courses only.
export const GET = withViewer(async (_req, viewer) => {
  return respond(await listMyDiyCourses(viewer));
});
