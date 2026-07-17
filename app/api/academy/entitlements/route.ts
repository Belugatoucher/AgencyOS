import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { grantEntitlement, grantInput, listEntitlements } from "@/lib/services/diy";

// Paid-course entitlements (db/008): manual grants by the team; a Stripe
// webhook lands later and does the same insert with source 'stripe'.

export const GET = withViewer(async (req, viewer) => {
  const courseId = z.string().uuid().parse(new URL(req.url).searchParams.get("course"));
  return respond(await listEntitlements(viewer, courseId));
});

export const POST = withViewer(async (req, viewer) => {
  const input = await parseBody(req, grantInput);
  return respond(await grantEntitlement(viewer, input), 201);
});
