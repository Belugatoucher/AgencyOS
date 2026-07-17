import { parseBody, respond, withViewer } from "@/lib/api";
import { createTemplate, listTemplates, templateInput } from "@/lib/services/onboarding";

// Project templates (docs/10). Internal only (service guard).

export const GET = withViewer(async (_req, viewer) => {
  return respond(await listTemplates(viewer));
});

export const POST = withViewer(async (req, viewer) => {
  const input = await parseBody(req, templateInput);
  return respond(await createTemplate(viewer, input), 201);
});
