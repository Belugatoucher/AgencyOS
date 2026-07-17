import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { askNotebook } from "@/lib/services/notebook";
import type { Viewer } from "@/lib/access";

// Slack slash commands (docs/16 `/handbook`). Requires the Slack app (doc 15):
// requests are authenticated by Slack's v0 HMAC signature — without
// SLACK_SIGNING_SECRET the endpoint is disabled (501), never open.

const MAX_SKEW_S = 300;

function verifySlackSignature(secret: string, timestamp: string, rawBody: string, signature: string): boolean {
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > MAX_SKEW_S) return false;
  const base = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${createHmac("sha256", secret).update(base).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) return NextResponse.json({ error: "Slack app not configured" }, { status: 501 });

  const raw = await req.text();
  const timestamp = req.headers.get("x-slack-request-timestamp") ?? "";
  const signature = req.headers.get("x-slack-signature") ?? "";
  if (!verifySlackSignature(secret, timestamp, raw, signature)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  const params = new URLSearchParams(raw);
  const command = params.get("command");
  const text = (params.get("text") ?? "").trim();
  if (command !== "/handbook") return NextResponse.json({ error: "Unknown command" }, { status: 400 });
  if (!text) {
    return NextResponse.json({ response_type: "ephemeral", text: "Usage: /handbook how do we run kickoffs?" });
  }

  // DECISION: Slack users aren't mapped to app users yet (needs the doc-15
  // Slack app's user directory); the workspace is internal-only, so the ask
  // runs as a synthetic member viewer and gaps attribute to the first admin.
  const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1);
  if (!admin) return NextResponse.json({ response_type: "ephemeral", text: "No admin user configured." });
  const viewer: Viewer = { id: admin.id, role: "member", membershipAccountIds: [] };

  const result = await askNotebook(viewer, text.slice(0, 2000));
  if (!result.ok) {
    return NextResponse.json({ response_type: "ephemeral", text: `Handbook error: ${result.error.message}` });
  }
  const cites = result.value.citations.length ? `\n\n_Sources: ${result.value.citations.join(", ")}_` : "";
  return NextResponse.json({ response_type: "ephemeral", text: result.value.answer + cites });
}
