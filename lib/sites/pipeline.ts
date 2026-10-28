// Sites pipeline (docs/18 "Stages"): pure functions, no imports, unit tested
// in pipeline.test.ts. Services feed in facts read from the DB; this module
// decides the stage, which actions are allowed, and what the dashboard should
// ask a human to do next.

export const SITE_STAGES = ["intake", "design", "build", "review", "live", "paused", "archived"] as const;
export type SiteStage = (typeof SITE_STAGES)[number];

export type DesignStatus = "drafting" | "proposed" | "approved" | "rejected" | "superseded" | "failed";
export type BuildStatus = "queued" | "running" | "awaiting_review" | "approved" | "rejected" | "failed" | "cancelled";
export type DeployStatus = "queued" | "building" | "ready" | "failed" | "rolled_back";
export type SnapshotStatus = "queued" | "running" | "done" | "failed";
export type HealthStatus = "ok" | "warn" | "fail" | "unknown";

export type PipelineFacts = {
  stage: SiteStage; // stored stage (paused/archived are sticky)
  snapshot: { id: string; status: SnapshotStatus } | null; // latest
  design: { id: string; version: number; status: DesignStatus } | null; // latest
  hasApprovedDesign: boolean;
  build: { id: string; kind: "initial" | "change" | "optimize"; status: BuildStatus } | null; // latest
  productionDeploy: { id: string; status: DeployStatus } | null; // latest production deploy
  hasLiveProduction: boolean; // any production deploy ever reached ready (and not rolled back to nothing)
  checks: { kind: string; status: HealthStatus; summary: string }[]; // latest per kind
};

const ACTIVE: readonly SiteStage[] = ["intake", "design", "build", "review", "live"];

/** Stage implied by what has happened. paused/archived only change by hand. */
export function deriveStage(f: PipelineFacts): SiteStage {
  if (f.stage === "paused" || f.stage === "archived") return f.stage;
  if (f.hasLiveProduction) return "live";
  if (f.build && (f.build.status === "awaiting_review" || f.build.status === "approved")) return "review";
  if (f.hasApprovedDesign) return "build";
  if (f.design || f.snapshot?.status === "done") return "design";
  return "intake";
}

/** Manual stage moves allowed from the UI. Forward moves are computed, never set. */
export function canSetStage(from: SiteStage, to: SiteStage): boolean {
  if (from === to) return false;
  if (to === "archived") return true;
  if (to === "paused") return ACTIVE.includes(from);
  // resuming: back to whatever the facts say (service recomputes after)
  if (from === "paused" || from === "archived") return ACTIVE.includes(to);
  return false;
}

// ---------- Gates ----------

export type Gate = { ok: true } | { ok: false; reason: string };
const pass: Gate = { ok: true };
const block = (reason: string): Gate => ({ ok: false, reason });

export function canStartIntake(f: Pick<PipelineFacts, "stage" | "snapshot">): Gate {
  if (f.stage === "archived") return block("This site is archived.");
  if (f.snapshot && (f.snapshot.status === "queued" || f.snapshot.status === "running"))
    return block("A crawl is already running.");
  return pass;
}

export function canProposeDesign(f: Pick<PipelineFacts, "stage" | "design">): Gate {
  if (f.stage === "archived" || f.stage === "paused") return block(`This site is ${f.stage}.`);
  if (f.design?.status === "drafting") return block("A proposal is already being drafted.");
  return pass;
}

export function canDecideDesign(status: DesignStatus): Gate {
  return status === "proposed" ? pass : block(`Only a proposed design can be approved or rejected (this one is ${status}).`);
}

export function canRequestBuild(
  f: Pick<PipelineFacts, "stage" | "hasApprovedDesign" | "build" | "hasLiveProduction">,
  kind: "initial" | "change" | "optimize",
): Gate {
  if (f.stage === "archived" || f.stage === "paused") return block(`This site is ${f.stage}.`);
  if (f.build && (f.build.status === "queued" || f.build.status === "running"))
    return block("A build is already in progress.");
  if (kind === "initial" && !f.hasApprovedDesign) return block("Approve a design system first.");
  if (kind !== "initial" && !f.hasLiveProduction) return block("Change and optimize builds need a live site.");
  return pass;
}

export function canDecideBuild(status: BuildStatus): Gate {
  return status === "awaiting_review" ? pass : block(`Only a build awaiting review can be approved or rejected (this one is ${status}).`);
}

export function canCancelBuild(status: BuildStatus): Gate {
  return status === "queued" || status === "running" ? pass : block("Only a queued or running build can be cancelled.");
}

// ---------- Health ----------

const RANK: Record<HealthStatus, number> = { ok: 0, unknown: 1, warn: 2, fail: 3 };

export function worstHealth(statuses: HealthStatus[]): HealthStatus {
  if (statuses.length === 0) return "unknown";
  return statuses.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "ok" as HealthStatus);
}

/** SSL/domain expiry thresholds: fail inside 7 days, warn inside 21. */
export function expiryStatus(daysLeft: number): HealthStatus {
  if (daysLeft < 7) return "fail";
  if (daysLeft < 21) return "warn";
  return "ok";
}

// ---------- Next action (dashboard) ----------

export type NextAction = {
  kind:
    | "start_intake"
    | "wait"
    | "retry_intake"
    | "propose_design"
    | "review_design"
    | "start_build"
    | "review_build"
    | "fix_build"
    | "fix_deploy"
    | "fix_health"
    | "none";
  label: string;
  priority: 0 | 1 | 2 | 3; // 3 = needs a human now
  ref?: string; // design/build/deploy id the action points at
};

export function nextActions(f: PipelineFacts): NextAction[] {
  const out: NextAction[] = [];
  const stage = deriveStage(f);

  for (const c of f.checks) {
    if (c.status === "fail") out.push({ kind: "fix_health", label: `Fix ${c.kind}: ${c.summary}`, priority: 3 });
    else if (c.status === "warn") out.push({ kind: "fix_health", label: `Check ${c.kind}: ${c.summary}`, priority: 2 });
  }
  if (f.productionDeploy?.status === "failed")
    out.push({ kind: "fix_deploy", label: "Production deploy failed", priority: 3, ref: f.productionDeploy.id });

  if (stage === "paused" || stage === "archived") {
    out.push({ kind: "none", label: stage === "paused" ? "Paused" : "Archived", priority: 0 });
    return sortActions(out);
  }

  if (f.build?.status === "awaiting_review")
    out.push({ kind: "review_build", label: `Review ${f.build.kind} build`, priority: 3, ref: f.build.id });
  else if (f.build?.status === "failed")
    out.push({ kind: "fix_build", label: `${cap(f.build.kind)} build failed`, priority: 2, ref: f.build.id });
  else if (f.build && (f.build.status === "queued" || f.build.status === "running"))
    out.push({ kind: "wait", label: `${cap(f.build.kind)} build running`, priority: 1, ref: f.build.id });

  if (f.design?.status === "proposed")
    out.push({ kind: "review_design", label: `Review design v${f.design.version}`, priority: 3, ref: f.design.id });
  else if (f.design?.status === "drafting")
    out.push({ kind: "wait", label: `Drafting design v${f.design.version}`, priority: 1, ref: f.design.id });

  if (stage === "intake") {
    if (!f.snapshot) out.push({ kind: "start_intake", label: "Start intake from the old site", priority: 2 });
    else if (f.snapshot.status === "failed") out.push({ kind: "retry_intake", label: "Crawl failed — retry intake", priority: 2 });
    else out.push({ kind: "wait", label: "Crawling the old site", priority: 1 });
  } else if (stage === "design") {
    const waiting = f.design && (f.design.status === "proposed" || f.design.status === "drafting");
    if (!waiting) out.push({ kind: "propose_design", label: f.design ? "Propose a new design" : "Propose a design system", priority: 2 });
  } else if (stage === "build") {
    const busy = f.build && ["queued", "running", "awaiting_review"].includes(f.build.status);
    if (!busy) out.push({ kind: "start_build", label: "Start the initial build", priority: 2 });
  }

  if (out.length === 0) out.push({ kind: "none", label: stage === "live" ? "All good" : "Nothing to do", priority: 0 });
  return sortActions(out);
}

function sortActions(a: NextAction[]): NextAction[] {
  return [...a].sort((x, y) => y.priority - x.priority);
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Lowercase-dash slug for repos/projects: "Granite Oak Waste!" → "granite-oak-waste". */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "site"
  );
}

/** Normalise user-entered URLs: adds https://, strips hash, rejects non-http(s) and private hosts. */
export function normalizeSiteUrl(raw: string): { ok: true; url: string; hostname: string } | { ok: false; reason: string } {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return { ok: false, reason: "That doesn't look like a web address." };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, reason: "Only http and https addresses work." };
  if (isPrivateHost(u.hostname)) return { ok: false, reason: "Private and local addresses can't be crawled." };
  u.hash = "";
  return { ok: true, url: u.toString(), hostname: u.hostname };
}

/** SSRF guard for the crawler and probes (literal hosts only; DNS is re-checked at fetch time). */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (!h.includes(".") && !h.includes(":")) return true; // single-label names
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (h.includes(":")) return h === "::1" || h === "::" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80") || h.startsWith("::ffff:");
  return false;
}
