import { parseBody, respond, withViewer } from "@/lib/api";
import { createRecurringRule, listRecurringRules, recurringRuleInput } from "@/lib/services/recurring";

export const GET = withViewer(async (_req, viewer) => {
  return respond(await listRecurringRules(viewer));
});

export const POST = withViewer(async (req, viewer) => {
  const input = await parseBody(req, recurringRuleInput);
  return respond(await createRecurringRule(viewer, input), 201);
});
