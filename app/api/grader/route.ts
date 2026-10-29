import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { deepSanitize } from "@/lib/sanitize";
import { publicGradeInput, requestPublicGrade } from "@/lib/services/grader";

// Public website grader (docs/18 "Grader") — the lead magnet. Unauthenticated.
// Controls (audit item 6): per-IP rate limit, body cap, deepSanitize + strict
// Zod with size caps, honeypot (silently accepted), daily spend cap in the
// service, SSRF-guarded fetches in the job. The work runs as a job (rule 4).
const MAX_BODY = 8 * 1024;

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limit = await rateLimit({ key: `grader:ip:${ip}`, limit: 5, windowSeconds: 60 * 60 });
  if (!limit.ok) return NextResponse.json({ error: "You've run a few reports already. Try again in an hour." }, { status: 429 });

  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  let body: unknown;
  try {
    body = deepSanitize(JSON.parse(raw));
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = publicGradeInput.safeParse(body);
  if (!parsed.success) {
    const urlIssue = parsed.error.issues.find((i) => i.path[0] === "url");
    return NextResponse.json({ error: urlIssue?.message ?? "Please check the form and try again." }, { status: 400 });
  }

  const result = await requestPublicGrade(parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: result.error.code === "rate_limited" ? 429 : 400 });
  return NextResponse.json({ token: result.value.token }, { status: 202 });
}
