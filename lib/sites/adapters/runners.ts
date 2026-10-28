import { createHmac, timingSafeEqual } from "node:crypto";
import type { BuildContext, BuildOutcome, BuildRunner, BuildStartResult } from "@/lib/sites/types";

// Build runners (docs/18). Two today:
//
// manual — a person runs the agent (Claude Code on their machine, with the
//   site's skill pack) and reports the result through the build's "Report
//   result" form. Zero infrastructure; this is how the first sites ship.
//
// remote — Agency OS hands the BuildContext to a separate runner service over
//   a small HTTP contract and polls it. The runner (Agent SDK / Claude Code in a
//   container, on the VPS or the Mac mini) owns the repo checkout, the agent
//   loop and the preview deploy. Keeping it out of this app means a runaway
//   agent can't take the platform down, and the runner can be rewritten freely.
//
// Remote runner contract (all requests signed: header x-sites-signature =
//   hex HMAC-SHA256(SITES_RUNNER_SECRET, `${timestamp}.${body}`), x-sites-timestamp):
//   POST   {SITES_RUNNER_URL}/runs           body: BuildContext   → { runRef }
//   GET    {SITES_RUNNER_URL}/runs/{runRef}                       → { done: false } | { done: true, outcome: BuildOutcome }
//   DELETE {SITES_RUNNER_URL}/runs/{runRef}                       → 204
// The runner MAY also POST the finished outcome to /api/sites/hooks/runner
// (same signature scheme) so builds don't wait for the next poll.

export const manualRunner: BuildRunner = {
  id: "manual",
  label: "Manual (run the agent yourself, then report back)",
  async start(ctx: BuildContext): Promise<BuildStartResult> {
    return { state: "manual", instructions: manualInstructions(ctx) };
  },
  async status() {
    return { done: false };
  },
  async cancel() {},
};

export function manualInstructions(ctx: BuildContext): string {
  const branch = suggestedBranch(ctx);
  return [
    `1. Open the site repo${ctx.site.repoRef ? ` (${ctx.site.repoRef})` : ""} and create branch \`${branch}\`.`,
    `2. Run Claude Code with the "${ctx.skillPack.id}" skill pack (v${ctx.skillPack.version}), phase "${ctx.skillPack.phase}": ${ctx.skillPack.root}/${ctx.skillPack.entry}`,
    ctx.designSystem
      ? `3. Give it the approved design system (copy it from the Design tab) and the brief below.`
      : `3. Give it the brief below.`,
    `4. Deploy a preview, then use "Report result" on this build with the preview URL, branch, commit and a short summary.`,
    ``,
    `Brief: ${ctx.brief?.trim() || "(none)"}`,
  ].join("\n");
}

export function suggestedBranch(ctx: Pick<BuildContext, "kind" | "buildId">): string {
  return `sites/${ctx.kind}-${ctx.buildId.slice(0, 8)}`;
}

// ---------- remote ----------

export function signRunnerPayload(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/** Verify a runner callback: signature over `${ts}.${body}`, 5-minute window, constant-time. */
export function verifyRunnerSignature(
  secret: string,
  headers: { signature: string | null; timestamp: string | null },
  body: string,
  now = Date.now(),
): boolean {
  if (!headers.signature || !headers.timestamp) return false;
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts * 1000) > 5 * 60 * 1000) return false;
  const expected = Buffer.from(signRunnerPayload(secret, headers.timestamp, body), "hex");
  const given = Buffer.from(headers.signature, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

function runnerConfig() {
  const url = process.env.SITES_RUNNER_URL;
  const secret = process.env.SITES_RUNNER_SECRET;
  if (!url || !secret) return null;
  return { url: url.replace(/\/+$/, ""), secret };
}

async function runnerCall(method: "GET" | "POST" | "DELETE", path: string, payload?: unknown): Promise<unknown> {
  const cfg = runnerConfig();
  if (!cfg) throw new Error("Remote runner is not configured (SITES_RUNNER_URL + SITES_RUNNER_SECRET)");
  const body = payload === undefined ? "" : JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000));
  const res = await fetch(`${cfg.url}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-sites-timestamp": ts,
      "x-sites-signature": signRunnerPayload(cfg.secret, ts, body),
    },
    body: body || undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(`Runner ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

export const remoteRunner: BuildRunner = {
  id: "remote",
  label: "Remote runner (Agent SDK / Claude Code container)",
  async start(ctx: BuildContext): Promise<BuildStartResult> {
    const r = (await runnerCall("POST", "/runs", ctx)) as { runRef?: string } | null;
    if (!r?.runRef) throw new Error("Runner did not return a runRef");
    return { state: "running", runRef: r.runRef };
  },
  async status(runRef: string) {
    const r = (await runnerCall("GET", `/runs/${encodeURIComponent(runRef)}`)) as
      | { done: false }
      | { done: true; outcome: BuildOutcome };
    return r;
  },
  async cancel(runRef: string) {
    await runnerCall("DELETE", `/runs/${encodeURIComponent(runRef)}`);
  },
};

export function remoteRunnerConfigured(): boolean {
  return runnerConfig() !== null;
}
