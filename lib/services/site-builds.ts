import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Viewer } from "@/lib/access";
import { db } from "@/lib/db";
import { siteBuilds, siteChecks, siteDeploys, siteDesignSystems, siteMetricsDaily, sites, siteSnapshots, type Site, type SiteBuild } from "@/lib/db/schema";
import { getQueue } from "@/lib/queues";
import { err, ok, type Result } from "@/lib/result";
import { canCancelBuild, canDecideBuild, canRequestBuild } from "@/lib/sites/pipeline";
import { runnerById, runnerFor } from "@/lib/sites/registry";
import { resolveSkillPack } from "@/lib/sites/skill-packs";
import type { BuildContext, BuildOutcome, DesignSystemDraft, SiteSnapshotResult } from "@/lib/sites/types";
import { latestApprovedDesign } from "@/lib/services/site-design";
import { expireStale, loadFacts, loadSite, notifySiteTeam, refreshStage, type SiteSettings } from "@/lib/services/sites";

// Builds (docs/18 steps 3–4). A build is one agent run: queued → running →
// awaiting_review (with a preview) → approved (→ production deploy) or
// rejected. Runners are adapters; this service never knows which agent ran.

const POLL_EVERY_MS = 60_000;
const MAX_POLL_HOURS = 6;
const LOG_CAP = 200;

export const BUILD_KINDS = ["initial", "change", "optimize"] as const;
export type BuildKind = (typeof BUILD_KINDS)[number];

export const requestBuildInput = z.object({
  kind: z.enum(BUILD_KINDS),
  brief: z.string().trim().max(8000).nullish(),
});

export const decideBuildInput = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(2000).nullish(),
});

/** What a runner (or a person, for manual builds) reports back. Zod-gated: it crosses a trust boundary. */
export const buildOutcomeInput = z.object({
  ok: z.boolean().default(true),
  branch: z.string().max(200).nullish(),
  commitSha: z
    .string()
    .regex(/^[0-9a-f]{7,40}$/i, "Commit should be a git SHA")
    .nullish(),
  previewUrl: z.string().url().max(500).nullish(),
  summary: z.string().trim().min(1).max(8000),
  changes: z
    .array(z.object({ path: z.string().max(300), action: z.enum(["add", "modify", "delete"]), note: z.string().max(300).optional() }))
    .max(500)
    .default([]),
  log: z
    .array(z.object({ at: z.string().max(40), level: z.enum(["info", "warn", "error"]), message: z.string().max(2000) }))
    .max(LOG_CAP)
    .default([]),
  error: z.string().max(2000).optional(),
});

// ---------- Request ----------

/** Shared by the route (viewer) and the weekly optimize cron (requestedBy null). */
export async function createBuild(
  site: Site,
  input: { kind: BuildKind; brief: string | null },
  requestedBy: string | null,
): Promise<Result<SiteBuild>> {
  await expireStale(site.id);
  const facts = await loadFacts(site.id);
  const gate = canRequestBuild(facts, input.kind);
  if (!gate.ok) return err("conflict", gate.reason);

  const pack = await resolveSkillPack(site.skillPack, input.kind === "optimize" ? "optimize" : "build");
  if (!pack.ok) return err("invalid", pack.reason);
  const design = await latestApprovedDesign(site.id);
  const runner = runnerFor((site.settings as SiteSettings).runner);

  const [row] = await db
    .insert(siteBuilds)
    .values({
      siteId: site.id,
      designSystemId: design?.id ?? null,
      kind: input.kind,
      brief: input.brief,
      runner: runner.id,
      skillPack: pack.pack.id,
      skillPackVersion: pack.pack.version,
      requestedBy,
    })
    .returning();
  await getQueue("sites").add("site-build", { buildId: row!.id }, { jobId: `build-${row!.id}` });
  await refreshStage(site.id);
  return ok(row!);
}

export async function requestBuild(viewer: Viewer, siteId: string, input: z.infer<typeof requestBuildInput>): Promise<Result<SiteBuild>> {
  const loaded = await loadSite(viewer, siteId, true);
  if (!loaded.ok) return loaded;
  return createBuild(loaded.value, { kind: input.kind, brief: input.brief ?? null }, viewer.id);
}

// ---------- Run (worker) ----------

async function buildContext(build: SiteBuild, site: Site): Promise<BuildContext> {
  const pack = await resolveSkillPack(build.skillPack, build.kind === "optimize" ? "optimize" : "build");
  if (!pack.ok) throw new Error(pack.reason);
  // the design that was approved when the build was requested, not whatever is newest now
  const [design] = build.designSystemId
    ? await db.select().from(siteDesignSystems).where(eq(siteDesignSystems.id, build.designSystemId))
    : [];
  const [snap] = await db
    .select()
    .from(siteSnapshots)
    .where(and(eq(siteSnapshots.siteId, site.id), eq(siteSnapshots.status, "done")))
    .orderBy(desc(siteSnapshots.createdAt))
    .limit(1);
  return {
    buildId: build.id,
    site: { id: site.id, slug: site.slug, name: site.name, domain: site.domain, repoRef: site.repoRef, hostRef: site.hostRef },
    kind: build.kind as BuildKind,
    brief: build.brief,
    designSystem: design
      ? ({ tokens: design.tokens, components: design.components, sitemap: design.sitemap, rationale: design.rationale ?? "" } as DesignSystemDraft)
      : null,
    snapshot: snap ? ({ pages: snap.pages, brand: snap.brand, audit: snap.audit } as SiteSnapshotResult) : null,
    skillPack: pack.pack,
    evidence: build.kind === "optimize" ? await optimizeEvidence(site.id) : {},
  };
}

/** Last 28 days of metrics + current checks, for optimize runs. */
async function optimizeEvidence(siteId: string) {
  const since = new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10);
  const [metrics, checks] = await Promise.all([
    db.select().from(siteMetricsDaily).where(and(eq(siteMetricsDaily.siteId, siteId), gte(siteMetricsDaily.date, since))),
    db.selectDistinctOn([siteChecks.kind]).from(siteChecks).where(eq(siteChecks.siteId, siteId)).orderBy(siteChecks.kind, desc(siteChecks.checkedAt)),
  ]);
  return {
    metrics: metrics.map((m) => ({ source: m.source, date: m.date, ...(m.metrics as Record<string, number>) })),
    checks: checks.map((c) => ({ kind: c.kind, status: c.status, summary: c.summary, detail: c.detail })),
  };
}

export async function runBuild(buildId: string) {
  const [build] = await db.select().from(siteBuilds).where(eq(siteBuilds.id, buildId));
  if (!build) throw new Error(`Build ${buildId} not found`);
  if (build.status !== "queued") return { buildId, skipped: build.status };
  const [site] = await db.select().from(sites).where(eq(sites.id, build.siteId));
  if (!site) throw new Error(`Site ${build.siteId} not found`);

  const ctx = await buildContext(build, site);
  const runner = runnerById(build.runner);
  const started = await runner.start(ctx);
  const now = new Date();

  if (started.state === "manual") {
    await db
      .update(siteBuilds)
      .set({ status: "running", startedAt: now, log: [{ at: now.toISOString(), level: "info", message: started.instructions }] })
      .where(eq(siteBuilds.id, buildId));
    await notifySiteTeam(site, "site_build_manual", `${cap(build.kind)} build is ready for someone to run — instructions are on the build.`);
    return { buildId, state: "manual" };
  }
  if (started.state === "running") {
    await db.update(siteBuilds).set({ status: "running", startedAt: now, runRef: started.runRef }).where(eq(siteBuilds.id, buildId));
    await getQueue("sites").add("site-build-poll", { buildId }, { delay: POLL_EVERY_MS, jobId: `poll-${buildId}-${Date.now()}` });
    return { buildId, state: "running", runRef: started.runRef };
  }
  await db.update(siteBuilds).set({ status: "running", startedAt: now }).where(eq(siteBuilds.id, buildId));
  return applyOutcome(buildId, started.outcome);
}

/** Worker: poll a remote run until it finishes or times out. */
export async function pollBuild(buildId: string) {
  const [build] = await db.select().from(siteBuilds).where(eq(siteBuilds.id, buildId));
  if (!build || build.status !== "running" || !build.runRef) return { buildId, skipped: build?.status ?? "missing" };
  const res = await runnerById(build.runner).status(build.runRef);
  if (res.done) return applyOutcome(buildId, res.outcome);
  const ageH = (Date.now() - (build.startedAt?.getTime() ?? Date.now())) / 3_600_000;
  if (ageH > MAX_POLL_HOURS) {
    await runnerById(build.runner).cancel(build.runRef).catch(() => {});
    return applyOutcome(buildId, { ok: false, branch: null, commitSha: null, previewUrl: null, summary: "", changes: [], log: [], error: `Run exceeded ${MAX_POLL_HOURS}h and was cancelled.` });
  }
  await getQueue("sites").add("site-build-poll", { buildId }, { delay: POLL_EVERY_MS, jobId: `poll-${buildId}-${Date.now()}` });
  return { buildId, state: "running" };
}

/** A finished run (any runner): store it, record the preview deploy, ask for review. */
export async function applyOutcome(buildId: string, outcome: BuildOutcome) {
  const [build] = await db.select().from(siteBuilds).where(eq(siteBuilds.id, buildId));
  if (!build) throw new Error(`Build ${buildId} not found`);
  if (build.status !== "running") return { buildId, skipped: build.status }; // late or duplicate report
  const [site] = await db.select().from(sites).where(eq(sites.id, build.siteId));
  if (!site) throw new Error(`Site ${build.siteId} not found`);

  const log = [...((build.log as BuildOutcome["log"]) ?? []), ...outcome.log].slice(-LOG_CAP);
  const finishedAt = new Date();
  if (!outcome.ok) {
    await db
      .update(siteBuilds)
      .set({ status: "failed", error: outcome.error ?? "Run failed", summary: outcome.summary || null, log, finishedAt })
      .where(eq(siteBuilds.id, buildId));
    await refreshStage(site.id);
    await notifySiteTeam(site, "site_build_failed", `${cap(build.kind)} build failed: ${(outcome.error ?? "").slice(0, 200)}`, true);
    return { buildId, status: "failed" };
  }

  await db
    .update(siteBuilds)
    .set({
      status: "awaiting_review",
      branch: outcome.branch,
      commitSha: outcome.commitSha,
      previewUrl: outcome.previewUrl,
      summary: outcome.summary,
      changes: outcome.changes,
      log,
      finishedAt,
    })
    .where(eq(siteBuilds.id, buildId));
  await db.insert(siteDeploys).values({
    siteId: site.id,
    buildId,
    environment: "preview",
    status: outcome.previewUrl ? "ready" : "failed",
    url: outcome.previewUrl,
    commitSha: outcome.commitSha,
    error: outcome.previewUrl ? null : "No preview URL reported",
    finishedAt,
  });
  if (outcome.previewUrl) await db.update(sites).set({ previewUrl: outcome.previewUrl, updatedAt: finishedAt }).where(eq(sites.id, site.id));
  await refreshStage(site.id);
  await notifySiteTeam(site, "site_build_review", `${cap(build.kind)} build is ready for review`, true);
  return { buildId, status: "awaiting_review" };
}

/** Manual runner: a person reports the result from the build card. */
export async function reportBuild(viewer: Viewer, buildId: string, input: z.infer<typeof buildOutcomeInput>): Promise<Result<SiteBuild>> {
  const [build] = await db.select().from(siteBuilds).where(eq(siteBuilds.id, buildId));
  if (!build) return err("not_found", "Build not found");
  const loaded = await loadSite(viewer, build.siteId, true);
  if (!loaded.ok) return loaded as Result<never>;
  if (build.runner !== "manual") return err("invalid", "Only manual builds take a hand-entered result.");
  if (build.status !== "running") return err("conflict", `This build is ${build.status.replace("_", " ")}.`);
  if (input.ok && !input.previewUrl) return err("invalid", "Add the preview URL so the team can review it.");
  await applyOutcome(buildId, {
    ok: input.ok,
    branch: input.branch ?? null,
    commitSha: input.commitSha ?? null,
    previewUrl: input.previewUrl ?? null,
    summary: input.summary,
    changes: input.changes,
    log: [{ at: new Date().toISOString(), level: "info", message: `Result reported by user ${viewer.id}` }, ...input.log],
    error: input.error,
  });
  return ok((await db.select().from(siteBuilds).where(eq(siteBuilds.id, buildId)))[0]!);
}

/** Remote runner callback (verified in the route). Idempotent: late/duplicate reports are ignored. */
export async function applyRunnerCallback(runRef: string, outcome: z.infer<typeof buildOutcomeInput>) {
  const [build] = await db.select().from(siteBuilds).where(and(eq(siteBuilds.runRef, runRef), eq(siteBuilds.status, "running")));
  if (!build) return { runRef, skipped: "no running build" };
  return applyOutcome(build.id, {
    ok: outcome.ok,
    branch: outcome.branch ?? null,
    commitSha: outcome.commitSha ?? null,
    previewUrl: outcome.previewUrl ?? null,
    summary: outcome.summary,
    changes: outcome.changes,
    log: outcome.log,
    error: outcome.error,
  });
}

// ---------- Decide / cancel ----------

export async function decideBuild(viewer: Viewer, buildId: string, input: z.infer<typeof decideBuildInput>): Promise<Result<SiteBuild>> {
  const [build] = await db.select().from(siteBuilds).where(eq(siteBuilds.id, buildId));
  if (!build) return err("not_found", "Build not found");
  const loaded = await loadSite(viewer, build.siteId, true);
  if (!loaded.ok) return loaded as Result<never>;
  const gate = canDecideBuild(build.status as never);
  if (!gate.ok) return err("conflict", gate.reason);
  if (input.decision === "reject" && !input.note) return err("invalid", "Say what's wrong so the next run can fix it.");

  const approve = input.decision === "approve";
  const [row] = await db
    .update(siteBuilds)
    .set({ status: approve ? "approved" : "rejected", decidedBy: viewer.id, decidedAt: new Date(), decisionNote: input.note ?? null })
    .where(eq(siteBuilds.id, buildId))
    .returning();
  if (approve) {
    // Production happens only here, after a human approved (docs/18).
    const [deploy] = await db
      .insert(siteDeploys)
      .values({ siteId: build.siteId, buildId, environment: "production", commitSha: build.commitSha, createdBy: viewer.id })
      .returning();
    await getQueue("sites").add("site-deploy", { deployId: deploy!.id }, { jobId: `deploy-${deploy!.id}` });
  }
  await refreshStage(build.siteId);
  return ok(row!);
}

export async function cancelBuild(viewer: Viewer, buildId: string): Promise<Result<SiteBuild>> {
  const [build] = await db.select().from(siteBuilds).where(eq(siteBuilds.id, buildId));
  if (!build) return err("not_found", "Build not found");
  const loaded = await loadSite(viewer, build.siteId, true);
  if (!loaded.ok) return loaded as Result<never>;
  const gate = canCancelBuild(build.status as never);
  if (!gate.ok) return err("conflict", gate.reason);
  if (build.runRef) await runnerById(build.runner).cancel(build.runRef).catch(() => {});
  const [row] = await db
    .update(siteBuilds)
    .set({ status: "cancelled", finishedAt: new Date(), decidedBy: viewer.id, decidedAt: new Date() })
    .where(eq(siteBuilds.id, buildId))
    .returning();
  await refreshStage(build.siteId);
  return ok(row!);
}

export async function listBuilds(viewer: Viewer, siteId: string) {
  const loaded = await loadSite(viewer, siteId);
  if (!loaded.ok) return loaded;
  return ok(await db.select().from(siteBuilds).where(eq(siteBuilds.siteId, siteId)).orderBy(desc(siteBuilds.createdAt)).limit(30));
}

// ---------- Weekly optimize (cron) ----------

/** Mon 07:30: one optimize build per live site that opted in and has nothing in flight. */
export async function optimizeWeekly() {
  const live = await db.select().from(sites).where(and(eq(sites.stage, "live")));
  let queued = 0;
  const skipped: string[] = [];
  for (const site of live) {
    if (site.deletedAt || !(site.settings as SiteSettings).autoOptimize) continue;
    const [inFlight] = await db
      .select({ id: siteBuilds.id })
      .from(siteBuilds)
      .where(and(eq(siteBuilds.siteId, site.id), inArray(siteBuilds.status, ["queued", "running", "awaiting_review"])))
      .limit(1);
    if (inFlight) {
      skipped.push(`${site.slug}: build in flight`);
      continue;
    }
    const r = await createBuild(site, { kind: "optimize", brief: "Weekly optimization run." }, null);
    if (r.ok) queued++;
    else skipped.push(`${site.slug}: ${r.error.message}`);
  }
  return { queued, skipped };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
