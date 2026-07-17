import { z } from "zod";
import { respond, withViewer } from "@/lib/api";
import { isInternal } from "@/lib/access";
import { getLead } from "@/lib/services/leads";
import { getQueue } from "@/lib/queues";
import { ok, err } from "@/lib/result";

type Params = { id: string };
const idSchema = z.string().uuid();

// Enqueue an AI scoring job (docs/02: >2s work is a BullMQ job, not inline).
export const POST = withViewer<Params>(async (_req, viewer, { id }) => {
  const leadId = idSchema.parse(id);
  if (!isInternal(viewer)) return respond(err("forbidden", "Leads are internal"));
  // ensure the lead is visible to this viewer before enqueueing
  const lead = await getLead(viewer, leadId);
  if (!lead.ok) return respond(lead);
  await getQueue("ai").add("score-lead", { leadId });
  return respond(ok({ enqueued: true }), 202);
});
