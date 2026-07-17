import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { statusForError } from "@/lib/result";
import { deepSanitize } from "@/lib/sanitize";
import { checkoutInput, startCheckout } from "@/lib/services/diy";
import { stripeConfigured } from "@/lib/stripe";

// Public checkout start (db/009): creates a Stripe Checkout Session and
// returns its URL. 501 until Stripe is configured — never an open endpoint.

const MAX_BODY = 4 * 1024;

export async function POST(req: Request) {
  if (!stripeConfigured()) return NextResponse.json({ error: "Payments not configured" }, { status: 501 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limit = await rateLimit({ key: `diybuy:ip:${ip}`, limit: 10, windowSeconds: 15 * 60 });
  if (!limit.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  let body: unknown;
  try {
    body = deepSanitize(JSON.parse(raw));
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = checkoutInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const result = await startCheckout(parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error.message }, { status: statusForError[result.error.code] });
  }
  return NextResponse.json(result.value);
}
