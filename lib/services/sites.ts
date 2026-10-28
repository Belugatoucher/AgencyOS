import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { canMutateAccount, canViewAccount, isInternal, type Viewer } from "@/lib/access";
import { db } from "@/lib/db";
import {
  accounts,
  siteBuilds,
  siteChecks,
  siteDeploys,
  siteDesignSystems,
  siteMetricsDaily,
  sites,
  siteSnapshots,
  users,
  type Site,
} from "@/lib/db/schema";
import { err, ok, type Result } from "@/lib/result";
import { notify } from "@/lib/services/notifications";
import {
  canSetStage,
  deriveStage,
  nextActions,
  normalizeSiteUrl,
  SITE_STAGES,
  slugify,
  worstHealth,
  type HealthStatus,
  type NextAction,
  type PipelineFacts,
  type SiteStage,
} from "@/lib/sites/pipeline";
import { capabilities, HOSTS } from "@/lib/sites/registry";
import { listSkillPacks } from "@/lib/sites/skill-packs";

// Sites (docs/18) — the spine of the module: CRUD, the pipeline facts every
// other sites service reads, and the dashboard overview.
// DECISION: Sites is internal-only (admin/member). Clients get a portal card
// later; every guard here returns not_found for clients so nothing is probeable.

// ---------- Guards ----------

export function siteGuard(viewer: Viewer, accountId: string, mutate = false): Result<true> {
  if (!isInternal(viewer)) return err("not_found", "Site not found");
  if (!canViewAccount(viewer, accountId)) return err("not_found", "Site not found");
  if (mutate && !canMutateAccount(viewer, accountId)) return err("forbidden", "Only the team can change sites");
  return ok(true);
}

/** Load a live (non-deleted) site the viewer may see. */
export async function loadSite(viewer: Viewer, siteId: string, mutate = false): Promise<Result<Site>> {
  if (!isInternal(viewer)) return err("not_found", "Site not found");
  const [site] = await db
    .select()
    .from(sites)
    .where(and(eq(sites.id, siteId), isNull(sites.deletedAt)));
  if (!site) return err("not_found", "Site not found");
  const g = siteGuard(viewer, site.accountId, mutate);
  return g.ok ? ok(site) : (g as Result<never>);
}

// ---------- Inputs ----------

const urlField = z
  .string()
  .max(500)
  .transform((v, ctx) => {
    const n = normalizeSiteUrl(v);
    if (!n.ok) {
      ctx.addIssue({ code: "custom", message: n.reason });
      return z.NEVER;
    }
    return n.url;
  });

const domainField = z
  .string()
  .max(253)
  .transform((v) => v.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
  .refine((v) => /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(v), "Enter a domain like example.com");

export const siteSettings = z
  .object({
    autoPropose: z.boolean().optional(), // propose a design as soon as the crawl finishes (default true)
    autoOptimize: z.boolean().optional(), // weekly optimize build (default false)
    runner: z.enum(["manual", "remote"]).optional(),
    maxPages: z.number().int().min(1).max(500).optional(),
    analytics: z
      .object({
        gsc: z.object({ property: z.string().max(200) }).optional(),
        ga4: z.object({ propertyId: z.string().max(40) }).optional(),
        ghl: z.object({ locationId: z.string().max(80).optional(), source: z.string().max(200).optional() }).optional(),
      })
      .optional(),
  })
  .strict();
export type SiteSettings = z.infer<typeof siteSettings>;

export const createSiteInput = z.object({
  accountId: z.string().uuid(),
  projectId: z.string().uuid().nullish(),
  name: z.string().trim().min(1).max(120),
  sourceUrl: urlField.nullish(),
  domain: domainField.nullish(),
  host: z.enum(HOSTS).default("manual"),
  skillPack: z.string().regex(/^[a-z0-9-]+$/).max(60).optional(),
  settings: siteSettings.default({}),
});

export const updateSiteInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    domain: domainField.nullable(),
    productionUrl: urlField.nullable(),
    sourceUrl: urlField.nullable(),
    host: z.enum(HOSTS),
    hostRef: z.string().max(200).nullable(),
    repo: z.enum(["manual", "github"]),
    repoRef: z
      .string()
      .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "Use owner/name")
      .nullable(),
    skillPack: z.string().regex(/^[a-z0-9-]+$/).max(60),
    settings: siteSettings,
    stage: z.enum(SITE_STAGES),
  })
  .partial();

// ---------- CRUD ----------

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  const taken = await db
    .select({ slug: sites.slug })
    .from(sites)
    .where(sql`${sites.slug} = ${base} or ${sites.slug} like ${`${base}-%`}`);
  const set = new Set(taken.map((t) => t.slug));
  if (!set.has(base)) return base;
  for (let i = 2; ; i++) if (!set.has(`${base}-${i}`)) return `${base}-${i}`;
}

export async function createSite(viewer: Viewer, input: z.infer<typeof createSiteInput>): Promise<Result<Site>> {
  const g = siteGuard(viewer, input.accountId, true);
  if (!g.ok) return g as Result<never>;
  const [account] = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, input.accountId));
  if (!account) return err("not_found", "Account not found");
  if (input.skillPack) {
    const packs = await listSkillPacks();
    if (!packs.some((p) => p.id === input.skillPack)) return err("invalid", `Skill pack "${input.skillPack}" isn't installed`);
  }
  const [row] = await db
    .insert(sites)
    .values({
      accountId: input.accountId,
      projectId: input.projectId ?? null,
      name: input.name,
      slug: await uniqueSlug(input.name),
      sourceUrl: input.sourceUrl ?? null,
      domain: input.domain ?? null,
      host: input.host,
      skillPack: input.skillPack ?? "vngrd-default",
      settings: input.settings,
      createdBy: viewer.id,
    })
    .returning();
  return ok(row!);
}

export async function updateSite(viewer: Viewer, siteId: string, input: z.infer<typeof updateSiteInput>): Promise<Result<Site>> {
  const loaded = await loadSite(viewer, siteId, true);
  if (!loaded.ok) return loaded;
  const site = loaded.value;
  const { stage, settings, ...rest } = input;
  if (stage && stage !== site.stage && !canSetStage(site.stage as SiteStage, stage)) {
    return err("invalid", "Stages move forward on their own — you can only pause, resume or archive a site.");
  }
  if (rest.skillPack && rest.skillPack !== site.skillPack) {
    const packs = await listSkillPacks();
    if (!packs.some((p) => p.id === rest.skillPack)) return err("invalid", `Skill pack "${rest.skillPack}" isn't installed`);
  }
  const [row] = await db
    .update(sites)
    .set({
      ...rest,
      ...(settings ? { settings: { ...(site.settings as SiteSettings), ...settings } } : {}),
      ...(stage ? { stage } : {}),
      updatedAt: new Date(),
    })
    .where(eq(sites.id, siteId))
    .returning();
  // resuming: let the facts decide where it lands
  if (stage && (site.stage === "paused" || site.stage === "archived") && stage !== "paused" && stage !== "archived") {
    await db.update(sites).set({ stage: "intake" }).where(eq(sites.id, siteId));
    await refreshStage(siteId);
    return ok((await db.select().from(sites).where(eq(sites.id, siteId)))[0]!);
  }
  return ok(row!);
}

export async function deleteSite(viewer: Viewer, siteId: string): Promise<Result<Site>> {
  const loaded = await loadSite(viewer, siteId, true);
  if (!loaded.ok) return loaded;
  const [row] = await db.update(sites).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(sites.id, siteId)).returning();
  return ok(row!);
}

// ---------- Pipeline facts ----------

export async function loadFacts(siteId: string): Promise<PipelineFacts> {
  const [site] = await db.select({ stage: sites.stage }).from(sites).where(eq(sites.id, siteId));
  const [[snapshot], [design], [approved], [build], [prodDeploy], [live], checks] = await Promise.all([
    db
      .select({ id: siteSnapshots.id, status: siteSnapshots.status })
      .from(siteSnapshots)
      .where(eq(siteSnapshots.siteId, siteId))
      .orderBy(desc(siteSnapshots.createdAt))
      .limit(1),
    db
      .select({ id: siteDesignSystems.id, version: siteDesignSystems.version, status: siteDesignSystems.status })
      .from(siteDesignSystems)
      .where(eq(siteDesignSystems.siteId, siteId))
      .orderBy(desc(siteDesignSystems.version))
      .limit(1),
    db
      .select({ id: siteDesignSystems.id })
      .from(siteDesignSystems)
      .where(and(eq(siteDesignSystems.siteId, siteId), eq(siteDesignSystems.status, "approved")))
      .limit(1),
    db
      .select({ id: siteBuilds.id, kind: siteBuilds.kind, status: siteBuilds.status })
      .from(siteBuilds)
      .where(eq(siteBuilds.siteId, siteId))
      .orderBy(desc(siteBuilds.createdAt))
      .limit(1),
    db
      .select({ id: siteDeploys.id, status: siteDeploys.status })
      .from(siteDeploys)
      .where(and(eq(siteDeploys.siteId, siteId), eq(siteDeploys.environment, "production")))
      .orderBy(desc(siteDeploys.createdAt))
      .limit(1),
    db
      .select({ id: siteDeploys.id })
      .from(siteDeploys)
      .where(and(eq(siteDeploys.siteId, siteId), eq(siteDeploys.environment, "production"), eq(siteDeploys.status, "ready")))
      .limit(1),
    latestChecks(siteId),
  ]);
  return {
    stage: (site?.stage ?? "intake") as SiteStage,
    snapshot: snapshot ? { id: snapshot.id, status: snapshot.status as never } : null,
    design: design ? { id: design.id, version: design.version, status: design.status as never } : null,
    hasApprovedDesign: Boolean(approved),
    build: build ? { id: build.id, kind: build.kind as never, status: build.status as never } : null,
    productionDeploy: prodDeploy ? { id: prodDeploy.id, status: prodDeploy.status as never } : null,
    hasLiveProduction: Boolean(live),
    checks: checks.map((c) => ({ kind: c.kind, status: c.status as HealthStatus, summary: c.summary })),
  };
}

/** Latest row per check kind. */
export async function latestChecks(siteId: string) {
  return db
    .selectDistinctOn([siteChecks.kind])
    .from(siteChecks)
    .where(eq(siteChecks.siteId, siteId))
    .orderBy(siteChecks.kind, desc(siteChecks.checkedAt));
}

/**
 * Jobs that died after their last retry leave rows in queued/running/drafting,
 * which would block the gates forever. Before any "start" action, rows older
 * than 30 minutes in those states are marked failed (the job_runs row already
 * holds the real error). Running builds are exempt — agent runs can take hours
 * and manual builds stay running until someone reports back.
 */
export async function expireStale(siteId: string): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 60_000);
  const note = "Timed out — the background job stopped. See Health for the error.";
  await Promise.all([
    db
      .update(siteSnapshots)
      .set({ status: "failed", error: note, finishedAt: new Date() })
      .where(and(eq(siteSnapshots.siteId, siteId), inArray(siteSnapshots.status, ["queued", "running"]), lt(siteSnapshots.createdAt, cutoff))),
    db
      .update(siteDesignSystems)
      .set({ status: "failed", error: note })
      .where(and(eq(siteDesignSystems.siteId, siteId), eq(siteDesignSystems.status, "drafting"), lt(siteDesignSystems.createdAt, cutoff))),
    db
      .update(siteBuilds)
      .set({ status: "failed", error: note, finishedAt: new Date() })
      .where(and(eq(siteBuilds.siteId, siteId), eq(siteBuilds.status, "queued"), lt(siteBuilds.createdAt, cutoff))),
  ]);
}

/** Recompute and persist the stage from facts. Called after every pipeline event. */
export async function refreshStage(siteId: string): Promise<SiteStage> {
  const facts = await loadFacts(siteId);
  const stage = deriveStage(facts);
  if (stage !== facts.stage) await db.update(sites).set({ stage, updatedAt: new Date() }).where(eq(sites.id, siteId));
  return stage;
}

// ---------- Read models ----------

export type SiteOverviewRow = {
  site: Pick<Site, "id" | "name" | "slug" | "stage" | "domain" | "productionUrl" | "previewUrl" | "host" | "accountId" | "updatedAt">;
  accountName: string;
  health: HealthStatus;
  checks: { kind: string; status: HealthStatus; summary: string }[];
  next: NextAction;
  lastDeployAt: string | null;
  clicks28d: number | null;
  leads28d: number | null;
};

export async function sitesOverview(viewer: Viewer, accountId?: string): Promise<Result<SiteOverviewRow[]>> {
  if (!isInternal(viewer)) return err("not_found", "Not found");
  if (accountId && !canViewAccount(viewer, accountId)) return err("not_found", "Account not found");
  const rows = await db
    .select({ site: sites, accountName: accounts.name })
    .from(sites)
    .innerJoin(accounts, eq(accounts.id, sites.accountId))
    .where(and(isNull(sites.deletedAt), accountId ? eq(sites.accountId, accountId) : undefined))
    .orderBy(accounts.name, sites.name);
  if (rows.length === 0) return ok([]);

  const ids = rows.map((r) => r.site.id);
  const since = new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10);
  const [lastDeploys, metrics] = await Promise.all([
    db
      .select({ siteId: siteDeploys.siteId, at: sql<string>`max(${siteDeploys.createdAt})` })
      .from(siteDeploys)
      .where(and(inArray(siteDeploys.siteId, ids), eq(siteDeploys.environment, "production")))
      .groupBy(siteDeploys.siteId),
    db
      .select({
        siteId: siteMetricsDaily.siteId,
        source: siteMetricsDaily.source,
        clicks: sql<number>`sum(coalesce((${siteMetricsDaily.metrics}->>'clicks')::numeric, 0))::int`,
        leads: sql<number>`sum(coalesce((${siteMetricsDaily.metrics}->>'leads')::numeric, 0))::int`,
      })
      .from(siteMetricsDaily)
      .where(and(inArray(siteMetricsDaily.siteId, ids), gte(siteMetricsDaily.date, since)))
      .groupBy(siteMetricsDaily.siteId, siteMetricsDaily.source),
  ]);

  // DECISION: facts load per site (a handful of indexed queries each). Fine at
  // agency scale (dozens of sites); a materialised overview is the fix past ~200.
  const out: SiteOverviewRow[] = [];
  for (const { site, accountName } of rows) {
    const facts = await loadFacts(site.id);
    const gsc = metrics.find((m) => m.siteId === site.id && m.source === "gsc");
    const ghl = metrics.find((m) => m.siteId === site.id && m.source === "ghl");
    out.push({
      site: {
        id: site.id,
        name: site.name,
        slug: site.slug,
        stage: site.stage,
        domain: site.domain,
        productionUrl: site.productionUrl,
        previewUrl: site.previewUrl,
        host: site.host,
        accountId: site.accountId,
        updatedAt: site.updatedAt,
      },
      accountName,
      health: worstHealth(facts.checks.map((c) => c.status)),
      checks: facts.checks,
      next: nextActions(facts)[0]!,
      lastDeployAt: lastDeploys.find((d) => d.siteId === site.id)?.at ?? null,
      clicks28d: gsc ? gsc.clicks : null,
      leads28d: ghl ? ghl.leads : null,
    });
  }
  return ok(out);
}

export async function getSiteDetail(viewer: Viewer, siteId: string) {
  const loaded = await loadSite(viewer, siteId);
  if (!loaded.ok) return loaded;
  const site = loaded.value;
  const [account] = await db.select({ name: accounts.name }).from(accounts).where(eq(accounts.id, site.accountId));
  const facts = await loadFacts(site.id);
  const packs = await listSkillPacks();
  return ok({
    site,
    accountName: account?.name ?? "",
    facts,
    actions: nextActions(facts),
    health: worstHealth(facts.checks.map((c) => c.status)),
    capabilities: capabilities(),
    skillPacks: packs.map((p) =>
      "invalid" in p
        ? { id: p.id, name: p.id, enabled: false, reason: p.invalid }
        : { id: p.id, name: p.name, version: p.version, enabled: p.enabled, reason: p.disabledReason ?? null, phases: Object.keys(p.phases) },
    ),
  });
}

// ---------- Notifications ----------

/** Admins + whoever created the site. Slack mirror for anything needing a human. */
export async function notifySiteTeam(site: Pick<Site, "id" | "name" | "createdBy">, kind: string, text: string, urgent = false) {
  const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
  const ids = [...admins.map((a) => a.id), ...(site.createdBy ? [site.createdBy] : [])];
  await notify(ids, {
    kind,
    body: { siteId: site.id, siteName: site.name, text, href: `/sites/${site.id}` },
    slackText: urgent ? `🌐 ${site.name}: ${text}` : undefined,
  });
}
