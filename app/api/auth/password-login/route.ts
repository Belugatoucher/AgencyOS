import { NextResponse } from "next/server";
import { statusForError } from "@/lib/result";
import { deepSanitize } from "@/lib/sanitize";
import { loginInput, loginWithPassword } from "@/lib/services/password-auth";

// Public password login: rate-limited, enumeration-safe (identical 401s),
// mints the same database session Auth.js reads. Cookie name/flags follow
// Auth.js conventions so both login paths share one session pipeline.

const MAX_BODY = 4 * 1024;

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  let body: unknown;
  try {
    body = deepSanitize(JSON.parse(raw));
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = loginInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Wrong email or password" }, { status: 401 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const result = await loginWithPassword(parsed.data.email, parsed.data.password, ip);
  if (!result.ok) {
    return NextResponse.json({ error: result.error.message }, { status: statusForError[result.error.code] });
  }

  const https =
    req.headers.get("x-forwarded-proto") === "https" ||
    (process.env.APP_URL ?? "").startsWith("https://");
  const cookieName = https ? "__Secure-authjs.session-token" : "authjs.session-token";
  const res = NextResponse.json({ ok: true });
  res.cookies.set(cookieName, result.value.sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: https,
    path: "/",
    expires: result.value.expires,
  });
  return res;
}
