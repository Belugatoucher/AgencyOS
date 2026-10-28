import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Viewer } from "@/lib/access";
import { db } from "@/lib/db";
import { siteDesignSystems, sites, siteSnapshots, type SiteSnapshot } from "@/lib/db/schema";
import { getQueue } from "@/lib/queues";
import { err, ok, type Result } from "@/lib/result";
import { canStartIntake, normalizeSiteUrl } from "@/lib/sites/pipeline";
import { crawlerFor } from "@/lib/sites/registry";
import type { SiteSnapshotResult } from "@/lib/sites/types";
import { expireStale, loadFacts, loadSite, notifySiteTeam, refreshStage, type SiteSettings } from "@/lib/services/sites";
import { queueProposal } from "@/lib/services/site-design";

// Intake (docs/18 step 1): crawl the old site into a snapshot. The crawl is a
// job (rule 4); the route only validates, records and enqueues.

const DEFAULT_MAX_PAGES = 60;
const PAGE_TIMEOUT_MS = 15_000;

export const intakeInput = z.object({
  sourceUrl: z.string().max(500).optional(), // defaults to the site's sourceUrl
  maxPages: z.number().int().min(1).max(500).optional(),
});

export async function startIntake(viewer: Viewer, siteId: string, input: z.infer<typeof intakeInput>): Promise<Result<SiteSnapshot>> {
  const loaded = await loadSite(viewer, siteId, true);
  if (!loaded.ok) return loaded;
  const site = loaded.value;
  const raw = input.sourceUrl ?? site.sourceUrl;
  if (!raw) return err("invalid", "Add the old site's address first.");
  const url = normalizeSiteUrl(raw);
  if (!url.ok) return err("invalid", url.reason);

  await expireStale(site.id);
  const facts = await loadFacts(site.id);
  const gate = canStartIntake(facts);
  if (!gate.ok) return err("conflict", gate.reason);

  const [snap] = await db
    .insert(siteSnapshots)
    .values({ siteId: site.id, sourceUrl: url.url, createdBy: viewer.id })
    .returning();
  if (site.sourceUrl !== url.url) await db.update(sites).set({ sourceUrl: url.url, updatedAt: new Date() }).where(eq(sites.id, site.id));
  const maxPages = input.maxPages ?? (site.settings as SiteSettings).maxPages ?? DEFAULT_MAX_PAGES;
  await getQueue("sites").add("site-crawl", { snapshotId: snap!.id, maxPages }, { jobId: `crawl-${snap!.id}` });
  return ok(snap!);
}

/** Worker: run the crawler, store the snapshot, then (by default) queue a design proposal. */
export async function runCrawl(snapshotId: string, maxPages = DEFAULT_MAX_PAGES) {
  const [snap] = await db.select().from(siteSnapshots).where(eq(siteSnapshots.id, snapshotId));
  if (!snap) throw new Error(`Snapshot ${snapshotId} not found`);
  if (snap.status === "done") return { snapshotId, skipped: "already done" };
  const [site] = await db.select().from(sites).where(eq(sites.id, snap.siteId));
  if (!site) throw new Error(`Site ${snap.siteId} not found`);

  await db.update(siteSnapshots).set({ status: "running", error: null }).where(eq(siteSnapshots.id, snapshotId));
  let result: SiteSnapshotResult;
  try {
    result = await crawlerFor().crawl(snap.sourceUrl, { maxPages, timeoutMs: PAGE_TIMEOUT_MS });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.update(siteSnapshots).set({ status: "failed", error: message.slice(0, 1000), finishedAt: new Date() }).where(eq(siteSnapshots.id, snapshotId));
    await notifySiteTeam(site, "site_intake_failed", `Crawl of ${snap.sourceUrl} failed: ${message.slice(0, 200)}`);
    // DECISION: an unreachable site is a result, not a transient error — no BullMQ retry.
    return { snapshotId, failed: message };
  }

  await db
    .update(siteSnapshots)
    .set({
      status: "done",
      pages: result.pages,
      brand: result.brand,
      audit: result.audit,
      pageCount: result.pages.length,
      finishedAt: new Date(),
    })
    .where(eq(siteSnapshots.id, snapshotId));
  await refreshStage(site.id);

  const settings = site.settings as SiteSettings;
  const [existingDesign] = await db
    .select({ id: siteDesignSystems.id })
    .from(siteDesignSystems)
    .where(eq(siteDesignSystems.siteId, site.id))
    .limit(1);
  if (settings.autoPropose !== false && !existingDesign) {
    await queueProposal(site.id, { brief: null, snapshotId, requestedBy: snap.createdBy });
  } else {
    await notifySiteTeam(site, "site_intake_done", `Crawled ${result.pages.length} pages from ${snap.sourceUrl}`);
  }
  return { snapshotId, pages: result.pages.length, broken: result.audit.brokenLinks.length };
}

export async function listSnapshots(viewer: Viewer, siteId: string) {
  const loaded = await loadSite(viewer, siteId);
  if (!loaded.ok) return loaded;
  // list view: summary columns only — pages can be large
  const rows = await db
    .select({
      id: siteSnapshots.id,
      sourceUrl: siteSnapshots.sourceUrl,
      status: siteSnapshots.status,
      pageCount: siteSnapshots.pageCount,
      brand: siteSnapshots.brand,
      audit: siteSnapshots.audit,
      error: siteSnapshots.error,
      createdAt: siteSnapshots.createdAt,
      finishedAt: siteSnapshots.finishedAt,
    })
    .from(siteSnapshots)
    .where(eq(siteSnapshots.siteId, siteId))
    .orderBy(desc(siteSnapshots.createdAt))
    .limit(20);
  return ok(rows);
}

export async function getSnapshot(viewer: Viewer, snapshotId: string): Promise<Result<SiteSnapshot>> {
  const [snap] = await db.select().from(siteSnapshots).where(eq(siteSnapshots.id, snapshotId));
  if (!snap) return err("not_found", "Snapshot not found");
  const loaded = await loadSite(viewer, snap.siteId);
  return loaded.ok ? ok(snap) : (loaded as Result<never>);
}
