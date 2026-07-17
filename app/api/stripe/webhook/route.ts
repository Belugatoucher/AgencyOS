import { NextResponse } from "next/server";
import { z } from "zod";
import { getQueue } from "@/lib/queues";
import { completedSession } from "@/lib/services/diy";
import { verifyStripeSignature } from "@/lib/stripe";

// Stripe webhook (db/009). CLAUDE.md rule 4 posture: verify the signature,
// enqueue the fulfillment job, 200 in <1s — the grant runs on the billing
// queue with retry + a job_runs row. 501 when unconfigured, never open.

const MAX_BODY = 256 * 1024;

const eventSchema = z.object({
  id: z.string(),
  type: z.string(),
  data: z.object({ object: z.unknown() }),
});

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Stripe not configured" }, { status: 501 });

  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  if (!verifyStripeSignature(secret, raw, req.headers.get("stripe-signature"))) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  let event: z.infer<typeof eventSchema>;
  try {
    event = eventSchema.parse(JSON.parse(raw));
  } catch {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = completedSession.safeParse(event.data.object);
    if (!session.success) {
      // Signed but malformed for our flow — acknowledge so Stripe stops
      // retrying, and log loudly for a human.
      console.error(`[stripe] unusable checkout.session.completed ${event.id}:`, session.error.issues);
      return NextResponse.json({ received: true, ignored: true });
    }
    if (session.data.payment_status === "paid") {
      // jobId = session id → BullMQ dedupes webhook redeliveries too.
      await getQueue("billing").add("stripe-entitle", session.data, { jobId: `stripe-${session.data.id}` });
    }
  }
  // Unhandled event types are acknowledged — subscribe narrowly in the
  // Stripe dashboard (checkout.session.completed only).
  return NextResponse.json({ received: true });
}
