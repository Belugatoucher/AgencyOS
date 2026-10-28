import { and, desc, eq, gte, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import type { Viewer } from "@/lib/access";
import { db } from "@/lib/db";
import { siteBuilds, siteChecks, siteDeploys, siteMetricsDaily, sites, type Site, type SiteDeploy } from "@/lib/db/schema";
import { getQueue } from "@/lib/queues";
import { err, ok, type Result } from "@/lib/result";
import { configuredSources, ALL_SOURCES } from "@/lib/sites/adapters/analytics";
import { ALL_PROBES } from "@/lib/sites/adapters/probes";
import { hostFor } from "@/lib/sites/registry";
import type { CheckResult } from "@/lib/sites/types";
import { latestChecks, loadSite, notifySiteTeam, refreshStage, type SiteSettings } from "@/lib/services/sites";

// Operate (docs/18 steps 4–5): deploys + rollback, health probes, analytics.

// ---------- Deploys ----------

export async function runDeploy(deployId: string) {
  const [deploy] = await db.select().from(siteDeploys).where(eq(siteDeploys.id, deployId));
  if (!deploy) throw new Error(`Deploy ${deployId} not found`);
  if (deploy.status !== "queued" && deploy.status !== "building") return { deployId, skipped: deploy.status };
  const [site] = await db.select().from(sites).where(eq(sites.id, deploy.siteId));
  if (!site) throw new Error(`Site ${deploy.siteId} not found`);
  const [build] = deploy.buildId ? await db.select().from(siteBuilds).where(eq(siteBuilds.id, deploy.buildId)) : [];

  const host = hostFor(site.host);
  await db.update(siteDeploys).set({ status: "building" }).where(eq(siteDeploys.id, deployId));
  const state = await host.deploy({
    site: { id: site.id, slug: site.slug, hostRef: site.hostRef, domain: site.domain },
    environment: deploy.environment as "preview" | "production",
    commitSha: deploy.commitSha,
    branch: build?.branch ?? null,
    knownUrl: deploy.environment === "production" ? site.productionUrl ?? build?.previewUrl ?? null : build?.previewUrl ?? null,
  });

  if (state.status === "building") {
    // provider is still working: record its ref; webhook or the next poll finishes it
    await db.update(siteDeploys).set({ providerRef: state.providerRef, url: state.url }).where(eq(siteDeploys.id, deployId));
    await getQueue("sites").add("site-deploy-poll", { deployId }, { delay: 30_000, jobId: `deploy-poll-${deployId}-${Date.now()}` });
    return { deployId, status: "building" };
  }
  return finishDeploy(deployId, state.status === "ready" ? { ok: true, url: state.url, providerRef: state.providerRef } : { ok: false, error: state.error });
}

export async function pollDeploy(deployId: string) {
  const [deploy] = await db.select().from(siteDeploys).where(eq(siteDeploys.id, deployId));
  if (!deploy || deploy.status !== "building" || !deploy.providerRef) return { deployId, skipped: deploy?.status ?? "missing" };
  const [site] = await db.select().from(sites).where(eq(sites.id, deploy.siteId));
  const state = await hostFor(site!.host).getDeploy(deploy.providerRef);
  if (state.status === "building") {
    if (Date.now() - deploy.createdAt.getTime() > 60 * 60_000) return finishDeploy(deployId, { ok: false, error: "Deploy took over an hour." });
    await getQueue("sites").add("site-deploy-poll", { deployId }, { delay: 30_000, jobId: `deploy-poll-${deployId}-${Date.now()}` });
    return { deployId, status: "building" };
  }
  return finishDeploy(deployId, state.status === "ready" ? { ok: true, url: state.url, providerRef: state.providerRef } : { ok: false, error: state.error });
}

async function finishDeploy(deployId: string, r: { ok: true; url: string | null; providerRef: string | null } | { ok: false; error: string }) {
  const [deploy] = await db
    .update(siteDeploys)
    .set(
      r.ok
        ? { status: "ready", url: r.url, providerRef: r.providerRef, finishedAt: new Date() }
        : { status: "failed", error: r.error.slice(0, 1000), finishedAt: new Date() },
    )
    .where(eq(siteDeploys.id, deployId))
    .returning();
  const [site] = await db.select().from(sites).where(eq(sites.id, deploy!.siteId));
  if (!site) return { deployId };
  if (deploy!.environment === "production") {
    if (r.ok) {
      if (r.url) await db.update(sites).set({ productionUrl: r.url, updatedAt: new Date() }).where(eq(sites.id, site.id));
      await refreshStage(site.id);
      await notifySiteTeam(site, "site_deployed", `Live: ${r.url ?? site.domain ?? "production"}`);
      await getQueue("sites").add("site-health", { siteId: site.id }, { jobId: `health-${site.id}-${Date.now()}` });
    } else {
      await refreshStage(site.id);
      await notifySiteTeam(site, "site_deploy_failed", `Production deploy failed: ${r.error.slice(0, 200)}`, true);
    }
  }
  return { deployId, status: deploy!.status };
}

export const rollbackInput = z.object({ note: z.string().trim().max(500).nullish() });

/**
 * Roll production back to an earlier ready production deploy: the current one
 * is marked rolled_back and a new production row records the restore, so the
 * history reads top-down.
 */
export async function rollbackTo(viewer: Viewer, targetDeployId: string): Promise<Result<SiteDeploy>> {
  const [target] = await db.select().from(siteDeploys).where(eq(siteDeploys.id, targetDeployId));
  if (!target) return err("not_found", "Deploy not found");
  const loaded = await loadSite(viewer, target.siteId, true);
  if (!loaded.ok) return loaded as Result<never>;
  const site = loaded.value;
  if (target.environment !== "production" || target.status !== "ready") return err("invalid", "You can only roll back to an earlier successful production deploy.");
  const [current] = await db
    .select()
    .from(siteDeploys)
    .where(and(eq(siteDeploys.siteId, site.id), eq(siteDeploys.environment, "production"), eq(siteDeploys.status, "ready")))
    .orderBy(desc(siteDeploys.createdAt))
    .limit(1);
  if (current?.id === target.id) return err("conflict", "That deploy is already live.");

  let state;
  try {
    state = await hostFor(site.host).rollback({
      site: { id: site.id, slug: site.slug, hostRef: site.hostRef, domain: site.domain },
      toProviderRef: target.providerRef,
    });
  } catch (e) {
    return err("invalid", e instanceof Error ? e.message : "Rollback failed");
  }
  if (state.status === "failed") return err("internal", `Rollback failed: ${state.error}`);
  if (current) await db.update(siteDeploys).set({ status: "rolled_back" }).where(eq(siteDeploys.id, current.id));
  const [row] = await db
    .insert(siteDeploys)
    .values({
      siteId: site.id,
      buildId: target.buildId,
      environment: "production",
      status: state.status === "ready" ? "ready" : "building",
      providerRef: state.providerRef,
      url: state.url ?? target.url,
      commitSha: target.commitSha,
      createdBy: viewer.id,
      finishedAt: state.status === "ready" ? new Date() : null,
    })
    .returning();
  if (state.status === "building") await getQueue("sites").add("site-deploy-poll", { deployId: row!.id }, { delay: 30_000, jobId: `deploy-poll-${row!.id}` });
  await notifySiteTeam(site, "site_rolled_back", `Production rolled back to the deploy from ${target.createdAt.toISOString().slice(0, 10)}`, true);
  return ok(row!);
}

export async function listDeploys(viewer: Viewer, siteId: string) {
  const loaded = await loadSite(viewer, siteId);
  if (!loaded.ok) return loaded;
  return ok(await db.select().from(siteDeploys).where(eq(siteDeploys.siteId, siteId)).orderBy(desc(siteDeploys.createdAt)).limit(50));
}

// ---------- Health ----------

function healthTarget(site: Pick<Site, "productionUrl" | "domain">): { url: string; hostname: string } | null {
  const url = site.productionUrl ?? (site.domain ? `https://${site.domain}` : null);
  if (!url) return null;
  try {
    return { url, hostname: new URL(url).hostname };
  } catch {
    return null;
  }
}

/** Worker: run every available probe, store results, alert on new failures. */
export async function runHealth(siteId: string) {
  const [site] = await db.select().from(sites).where(eq(sites.id, siteId));
  if (!site || site.deletedAt) return { siteId, skipped: "missing" };
  const target = healthTarget(site);
  if (!target) return { siteId, skipped: "no production URL or domain" };

  const previous = await latestChecks(siteId);
  const results: CheckResult[] = [];
  for (const probe of ALL_PROBES.filter((p) => p.available())) {
    results.push(await probe.run({ ...target, siteId }));
  }
  if (results.length) await db.insert(siteChecks).values(results.map((r) => ({ siteId, kind: r.kind, status: r.status, summary: r.summary, detail: r.detail })));

  const newlyFailing = results.filter((r) => r.status === "fail" && previous.find((p) => p.kind === r.kind)?.status !== "fail");
  const recovered = results.filter((r) => r.status === "ok" && previous.find((p) => p.kind === r.kind)?.status === "fail");
  if (newlyFailing.length) await notifySiteTeam(site, "site_health_fail", newlyFailing.map((r) => `${r.kind}: ${r.summary}`).join(" · "), true);
  if (recovered.length) await notifySiteTeam(site, "site_health_recovered", `Recovered: ${recovered.map((r) => r.kind).join(", ")}`);
  return { siteId, checks: results.length, failing: results.filter((r) => r.status === "fail").length };
}

/** Cron (every 15 min): queue a health run for every live site. */
export async function healthSweep() {
  const live = await db.select({ id: sites.id }).from(sites).where(and(eq(sites.stage, "live"), isNull(sites.deletedAt)));
  const slot = Math.floor(Date.now() / (15 * 60_000));
  for (const s of live) await getQueue("sites").add("site-health", { siteId: s.id }, { jobId: `health-${s.id}-${slot}` });
  // DECISION: keep 30 days of raw checks; the latest-per-kind index serves the dashboard.
  await db.delete(siteChecks).where(lt(siteChecks.checkedAt, new Date(Date.now() - 30 * 86_400_000)));
  return { queued: live.length };
}

export async function requestHealthRun(viewer: Viewer, siteId: string): Promise<Result<{ queued: true }>> {
  const loaded = await loadSite(viewer, siteId, true);
  if (!loaded.ok) return loaded as Result<never>;
  if (!healthTarget(loaded.value)) return err("invalid", "Add a domain or production URL first.");
  await getQueue("sites").add("site-health", { siteId }, { jobId: `health-${siteId}-${Date.now()}` });
  return ok({ queued: true });
}

export async function siteHealth(viewer: Viewer, siteId: string) {
  const loaded = await loadSite(viewer, siteId);
  if (!loaded.ok) return loaded;
  const since = new Date(Date.now() - 7 * 86_400_000);
  const [latest, history] = await Promise.all([
    latestChecks(siteId),
    db
      .select({ kind: siteChecks.kind, status: siteChecks.status, checkedAt: siteChecks.checkedAt })
      .from(siteChecks)
      .where(and(eq(siteChecks.siteId, siteId), gte(siteChecks.checkedAt, since)))
      .orderBy(desc(siteChecks.checkedAt))
      .limit(2000),
  ]);
  return ok({
    target: healthTarget(loaded.value),
    latest,
    history,
    probes: ALL_PROBES.map((p) => ({ kind: p.kind, available: p.available() })),
  });
}

// ---------- Analytics ----------

/** Cron (nightly 03:15): each configured source pulls yesterday for each live site. */
export async function analyticsPull(date = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)) {
  const live = await db.select().from(sites).where(and(eq(sites.stage, "live"), isNull(sites.deletedAt)));
  let rows = 0;
  const errors: string[] = [];
  for (const site of live) {
    const settings = (site.settings ?? {}) as Record<string, unknown>;
    for (const source of configuredSources({ id: site.id, settings })) {
      try {
        const metrics = await source.pullDaily({ id: site.id, domain: site.domain, settings }, date);
        await db
          .insert(siteMetricsDaily)
          .values({ siteId: site.id, source: source.id, date, metrics })
          .onConflictDoUpdate({ target: [siteMetricsDaily.siteId, siteMetricsDaily.source, siteMetricsDaily.date], set: { metrics } });
        rows++;
      } catch (e) {
        errors.push(`${site.slug}/${source.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  if (errors.length && rows === 0 && live.length > 0) throw new Error(errors.slice(0, 5).join(" | ")); // surface in job_runs
  return { date, rows, errors };
}

export const analyticsQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(28) });

export async function siteAnalytics(viewer: Viewer, siteId: string, days: number) {
  const loaded = await loadSite(viewer, siteId);
  if (!loaded.ok) return loaded;
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const rows = await db
    .select({ source: siteMetricsDaily.source, date: siteMetricsDaily.date, metrics: siteMetricsDaily.metrics })
    .from(siteMetricsDaily)
    .where(and(eq(siteMetricsDaily.siteId, siteId), gte(siteMetricsDaily.date, since)))
    .orderBy(siteMetricsDaily.date);
  const settings = (loaded.value.settings ?? {}) as SiteSettings & Record<string, unknown>;
  return ok({
    rows,
    sources: ALL_SOURCES.map((s) => ({
      id: s.id,
      configured: Boolean((settings.analytics as Record<string, unknown> | undefined)?.[s.id]),
      available: s.available({ id: siteId, settings }),
    })),
  });
}

