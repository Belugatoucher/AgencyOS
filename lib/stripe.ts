import { createHmac, timingSafeEqual } from "node:crypto";

// Stripe integration, dependency-free (matches the codebase posture: the GHL
// and Slack rails are plain fetch/HMAC too). Two pieces:
//   - Checkout Sessions via the REST API (form-encoded; price inline from
//     courses.price_cents, so no dashboard product setup is required)
//   - webhook signature verification (v1 scheme: HMAC-SHA256 of
//     "<timestamp>.<payload>", 5-minute tolerance, constant-time compare)
// Unset keys = feature disabled (routes return 501) — never an open endpoint.

const STRIPE_API = "https://api.stripe.com/v1";
const SIGNATURE_TOLERANCE_S = 300;

export function stripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

export type CheckoutSession = { id: string; url: string };

/** Create a payment-mode Checkout Session for one course. */
export async function createCheckoutSession(opts: {
  courseId: string;
  courseTitle: string;
  amountCents: number;
  currency?: string;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<CheckoutSession> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");

  const body = new URLSearchParams({
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": opts.currency ?? "usd",
    "line_items[0][price_data][unit_amount]": String(opts.amountCents),
    "line_items[0][price_data][product_data][name]": opts.courseTitle,
    "metadata[course_id]": opts.courseId,
    client_reference_id: opts.courseId,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
  });
  if (opts.customerEmail) body.set("customer_email", opts.customerEmail);

  const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const json = (await res.json()) as { id?: string; url?: string; error?: { message?: string } };
  if (!res.ok || !json.id || !json.url) {
    throw new Error(`Stripe checkout failed: ${json.error?.message ?? res.status}`);
  }
  return { id: json.id, url: json.url };
}

/**
 * Verify a `stripe-signature` header against the raw body. Exported pure so
 * the verifier is unit-testable and the e2e can sign synthetic events.
 */
export function verifyStripeSignature(
  secret: string,
  rawBody: string,
  header: string | null,
  nowS = Math.floor(Date.now() / 1000),
): boolean {
  if (!header) return false;
  const parts = new Map<string, string[]>();
  for (const kv of header.split(",")) {
    const [k, v] = kv.split("=", 2);
    if (!k || !v) continue;
    const list = parts.get(k.trim()) ?? [];
    list.push(v.trim());
    parts.set(k.trim(), list);
  }
  const timestamp = parts.get("t")?.[0];
  const signatures = parts.get("v1") ?? [];
  if (!timestamp || signatures.length === 0) return false;
  if (!/^\d+$/.test(timestamp) || Math.abs(nowS - Number(timestamp)) > SIGNATURE_TOLERANCE_S) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const expectedBuf = Buffer.from(expected);
  return signatures.some((sig) => {
    const buf = Buffer.from(sig);
    return buf.length === expectedBuf.length && timingSafeEqual(buf, expectedBuf);
  });
}

/** Build a signature header (test/e2e helper — same scheme Stripe uses). */
export function signStripePayload(secret: string, rawBody: string, timestampS = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac("sha256", secret).update(`${timestampS}.${rawBody}`).digest("hex");
  return `t=${timestampS},v1=${sig}`;
}
