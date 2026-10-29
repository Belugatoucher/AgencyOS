import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { createGoal, goalInput, listGoals } from "@/lib/services/ideation";

// Goals per business (docs/19). Internal-only: the service 404s clients.

export const GET = withViewer(async (req, viewer) => {
  const account = z.string().uuid().parse(new URL(req.url).searchParams.get("account"));
  return respond(await listGoals(viewer, account));
});

export const POST = withViewer(async (req, viewer) => {
  return respond(await createGoal(viewer, await parseBody(req, goalInput)), 201);
});
