import { NextResponse } from "next/server";
import { z } from "zod";
import { getQueue } from "@/lib/queues";
import { verifyRunnerSignature } from "@/lib/sites/adapters/runners";

// Inbound callbacks for Sites (docs/18). Rule 4 posture: verify, enqueue,
// 200 in <1s. 501 when unconfigured, never open.
//  - runner: remote build runner finished a run (HMAC, SITES_RUNNER_SECRET)
//  - cloudflare / vercel: deploy webhooks — 501 until those host adapters land

const MAX_BODY = 512 * 1024;
const runnerEvent = z.object({ runRef: z.string().min(1).max(200), outcome: z.unknown() });

export async function POST(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  if (provider !== "runner") return NextResponse.json({ error: "Not configured" }, { status: 501 });

  const secret = process.env.SITES_RUNNER_SECRET;
  if (!secret) return NextResponse.json({ error: "Not configured" }, { status: 501 });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  const ok = verifyRunnerSignature(
    secret,
    { signature: req.headers.get("x-sites-signature"), timestamp: req.headers.get("x-sites-timestamp") },
    raw,
  );
  if (!ok) return NextResponse.json({ error: "Bad signature" }, { status: 401 });

  let event: z.infer<typeof runnerEvent>;
  try {
    event = runnerEvent.parse(JSON.parse(raw));
  } catch {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }
  // outcome is Zod-parsed in the job; jobId dedupes redeliveries
  await getQueue("sites").add("site-runner-callback", event, { jobId: `runner-${event.runRef}` });
  return NextResponse.json({ received: true });
}
