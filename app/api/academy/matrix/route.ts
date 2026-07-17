import { respond, withViewer } from "@/lib/api";
import { completionMatrix } from "@/lib/services/academy";

// People × courses completion matrix (docs/16) — managers (admin) only.
export const GET = withViewer(async (_req, viewer) => {
  return respond(await completionMatrix(viewer));
});
