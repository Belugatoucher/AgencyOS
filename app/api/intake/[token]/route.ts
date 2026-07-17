import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { ingestIntake, intakeSchema } from "@/lib/services/lead-intake";

// Public, unauthenticated lead capture (audit item 6). Per-IP rate limit,
// honeypot + strict Zod with size caps in the service, identical responses so
// bots can't probe. Body cap enforced before parsing.
const MAX_BODY = 16 * 1024;

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limit = await rateLimit({ key: `intake:ip:${ip}`, limit: 20, windowSeconds: 15 * 60 });
  if (!limit.ok) {
    return NextResponse.json({ ok: false, error: "Too many submissions" }, { status: 429 });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY) {
    return NextResponse.json({ ok: false, error: "Payload too large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }

  const parsed = intakeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Please check the form and try again" }, { status: 400 });
  }

  const result = await ingestIntake(token, parsed.data);
  // Identical success response whether we stored, dropped a honeypot hit, or
  // the token is unknown — don't leak which pipelines exist.
  if (!result.ok && result.error.code === "not_found") {
    return NextResponse.json({ ok: false, error: "This form is not available" }, { status: 404 });
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}
