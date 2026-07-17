import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";
import { statusForError } from "@/lib/result";
import { getPublicIntake, intakeSections, savePublicIntake } from "@/lib/services/onboarding";

// Public intake form (docs/10; audit item 6): token-gated, no login. Per-IP
// rate limit, body cap, strict Zod with size caps, identical not-found
// responses for bad/expired/committed tokens.

const MAX_BODY = 64 * 1024;
const saveBody = z.object({ sections: intakeSections, submit: z.boolean().default(false) });

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limit = await rateLimit({ key: `onboard:ip:${ip}`, limit: 60, windowSeconds: 15 * 60 });
  if (!limit.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const result = await getPublicIntake(token);
  if (!result.ok) {
    return NextResponse.json({ error: result.error.message }, { status: statusForError[result.error.code] });
  }
  return NextResponse.json(result.value);
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limit = await rateLimit({ key: `onboard:ip:${ip}`, limit: 60, windowSeconds: 15 * 60 });
  if (!limit.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = saveBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Please check the form and try again" }, { status: 400 });
  }

  const result = await savePublicIntake(token, parsed.data.sections, parsed.data.submit);
  if (!result.ok) {
    return NextResponse.json({ error: result.error.message }, { status: statusForError[result.error.code] });
  }
  return NextResponse.json(result.value);
}
