import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { createIntake, listIntakes } from "@/lib/services/onboarding";

// Intake forms (docs/10). Internal only (service guard).

const body = z.object({ accountId: z.string().uuid() });

export const GET = withViewer(async (req, viewer) => {
  const account = z.string().uuid().parse(new URL(req.url).searchParams.get("account"));
  return respond(await listIntakes(viewer, account));
});

export const POST = withViewer(async (req, viewer) => {
  const { accountId } = await parseBody(req, body);
  return respond(await createIntake(viewer, accountId), 201);
});
