import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import type { Viewer } from "@/lib/access";
import { db } from "@/lib/db";
import { accounts, siteDesignSystems, sites, siteSnapshots, type SiteDesignSystem } from "@/lib/db/schema";
import { getQueue } from "@/lib/queues";
import { err, ok, type Result } from "@/lib/result";
import { canDecideDesign, canProposeDesign } from "@/lib/sites/pipeline";
import { proposerFor } from "@/lib/sites/registry";
import type { DesignSystemDraft, SiteSnapshotResult } from "@/lib/sites/types";
import { expireStale, loadFacts, loadSite, notifySiteTeam, refreshStage } from "@/lib/services/sites";

// Design system proposals (docs/18 step 2). A proposal is drafted by a job,
// lands as `proposed`, and only a human moves it to approved/rejected.
// Approving one supersedes any earlier approved version.

export const proposeInput = z.object({
  brief: z.string().trim().max(4000).nullish(),
  snapshotId: z.string().uuid().nullish(), // defaults to the latest finished crawl
});

export const decideDesignInput = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(2000).nullish(),
});

/** Shared by the route and the post-crawl hook: next version row + job. */
export async function queueProposal(
  siteId: string,
  opts: { brief: string | null; snapshotId: string | null; requestedBy: string | null },
): Promise<SiteDesignSystem> {
  const [latest] = await db
    .select({ version: siteDesignSystems.version })
    .from(siteDesignSystems)
    .where(eq(siteDesignSystems.siteId, siteId))
    .orderBy(desc(siteDesignSystems.version))
    .limit(1);
  let snapshotId = opts.snapshotId;
  if (!snapshotId) {
    const [snap] = await db
      .select({ id: siteSnapshots.id })
      .from(siteSnapshots)
      .where(and(eq(siteSnapshots.siteId, siteId), eq(siteSnapshots.status, "done")))
      .orderBy(desc(siteSnapshots.createdAt))
      .limit(1);
    snapshotId = snap?.id ?? null;
  }
  // an unanswered proposal is replaced, not left dangling
  await db
    .update(siteDesignSystems)
    .set({ status: "superseded" })
    .where(and(eq(siteDesignSystems.siteId, siteId), eq(siteDesignSystems.status, "proposed")));
  const [row] = await db
    .insert(siteDesignSystems)
    .values({ siteId, snapshotId, version: (latest?.version ?? 0) + 1, status: "drafting", brief: opts.brief })
    .returning();
  await getQueue("sites").add("site-propose-design", { designSystemId: row!.id }, { jobId: `design-${row!.id}` });
  await refreshStage(siteId);
  return row!;
}

export async function proposeDesign(viewer: Viewer, siteId: string, input: z.infer<typeof proposeInput>): Promise<Result<SiteDesignSystem>> {
  const loaded = await loadSite(viewer, siteId, true);
  if (!loaded.ok) return loaded;
  await expireStale(siteId);
  const facts = await loadFacts(siteId);
  const gate = canProposeDesign(facts);
  if (!gate.ok) return err("conflict", gate.reason);
  if (input.snapshotId) {
    const [snap] = await db.select({ siteId: siteSnapshots.siteId, status: siteSnapshots.status }).from(siteSnapshots).where(eq(siteSnapshots.id, input.snapshotId));
    if (!snap || snap.siteId !== siteId) return err("not_found", "Snapshot not found");
    if (snap.status !== "done") return err("invalid", "That crawl hasn't finished.");
  }
  if (!process.env.ANTHROPIC_API_KEY) return err("invalid", "Design proposals need ANTHROPIC_API_KEY on the server.");
  return ok(await queueProposal(siteId, { brief: input.brief ?? null, snapshotId: input.snapshotId ?? null, requestedBy: viewer.id }));
}

/** Worker: call the proposer, store the draft as `proposed`. */
export async function runProposal(designSystemId: string) {
  const [ds] = await db.select().from(siteDesignSystems).where(eq(siteDesignSystems.id, designSystemId));
  if (!ds) throw new Error(`Design system ${designSystemId} not found`);
  if (ds.status !== "drafting") return { designSystemId, skipped: ds.status };
  const [site] = await db.select().from(sites).where(eq(sites.id, ds.siteId));
  if (!site) throw new Error(`Site ${ds.siteId} not found`);
  const [account] = await db.select().from(accounts).where(eq(accounts.id, site.accountId));

  let snapshot: SiteSnapshotResult | null = null;
  if (ds.snapshotId) {
    const [snap] = await db.select().from(siteSnapshots).where(eq(siteSnapshots.id, ds.snapshotId));
    if (snap) snapshot = { pages: snap.pages as never, brand: snap.brand as never, audit: snap.audit as never };
  }
  // the last proposal the team turned down, so the next one answers the note
  const [previous] = await db
    .select()
    .from(siteDesignSystems)
    .where(and(eq(siteDesignSystems.siteId, site.id), eq(siteDesignSystems.status, "rejected"), ne(siteDesignSystems.id, ds.id)))
    .orderBy(desc(siteDesignSystems.version))
    .limit(1);

  let draft: DesignSystemDraft;
  try {
    draft = await proposerFor().propose({
      siteName: site.name,
      accountName: account?.name ?? "",
      brief: ds.brief,
      snapshot,
      brand: (account?.brand as Record<string, unknown>) ?? {},
      previous: previous
        ? ({ tokens: previous.tokens, components: previous.components, sitemap: previous.sitemap, rationale: previous.rationale ?? "" } as DesignSystemDraft)
        : null,
      previousNote: previous?.decisionNote ?? null,
    });
  } catch (e) {
    // Bad output after the proposer's one retry, or no API key, won't improve
    // with BullMQ retries: mark failed + tell the team, then fail the job
    // loudly (rule 6). Anything else (network, 5xx) rethrows for retry.
    const message = e instanceof Error ? e.message : String(e);
    const permanent = e instanceof SyntaxError || (e instanceof Error && e.name === "ZodError") || /ANTHROPIC_API_KEY/.test(message);
    if (permanent) {
      await db.update(siteDesignSystems).set({ status: "failed", error: message.slice(0, 1000) }).where(eq(siteDesignSystems.id, ds.id));
      await refreshStage(site.id);
      await notifySiteTeam(site, "site_design_failed", `Design v${ds.version} couldn't be drafted: ${message.slice(0, 200)}`);
    }
    throw e;
  }

  await db
    .update(siteDesignSystems)
    .set({
      status: "proposed",
      tokens: draft.tokens,
      components: draft.components,
      sitemap: draft.sitemap,
      rationale: draft.rationale,
      error: null,
    })
    .where(eq(siteDesignSystems.id, ds.id));
  await refreshStage(site.id);
  await notifySiteTeam(site, "site_design_proposed", `Design v${ds.version} is ready for review`, true);
  return { designSystemId, pages: draft.sitemap.length, components: draft.components.length };
}

export async function decideDesign(viewer: Viewer, designSystemId: string, input: z.infer<typeof decideDesignInput>): Promise<Result<SiteDesignSystem>> {
  const [ds] = await db.select().from(siteDesignSystems).where(eq(siteDesignSystems.id, designSystemId));
  if (!ds) return err("not_found", "Design system not found");
  const loaded = await loadSite(viewer, ds.siteId, true);
  if (!loaded.ok) return loaded as Result<never>;
  const gate = canDecideDesign(ds.status as never);
  if (!gate.ok) return err("conflict", gate.reason);
  if (input.decision === "reject" && !input.note) return err("invalid", "Say what to change — the next proposal reads your note.");

  const approve = input.decision === "approve";
  if (approve) {
    await db
      .update(siteDesignSystems)
      .set({ status: "superseded" })
      .where(and(eq(siteDesignSystems.siteId, ds.siteId), inArray(siteDesignSystems.status, ["approved"])));
  }
  const [row] = await db
    .update(siteDesignSystems)
    .set({
      status: approve ? "approved" : "rejected",
      decidedBy: viewer.id,
      decidedAt: new Date(),
      decisionNote: input.note ?? null,
    })
    .where(eq(siteDesignSystems.id, ds.id))
    .returning();
  await refreshStage(ds.siteId);
  return ok(row!);
}

export async function listDesignSystems(viewer: Viewer, siteId: string) {
  const loaded = await loadSite(viewer, siteId);
  if (!loaded.ok) return loaded;
  return ok(
    await db.select().from(siteDesignSystems).where(eq(siteDesignSystems.siteId, siteId)).orderBy(desc(siteDesignSystems.version)).limit(20),
  );
}

export async function latestApprovedDesign(siteId: string): Promise<SiteDesignSystem | null> {
  const [ds] = await db
    .select()
    .from(siteDesignSystems)
    .where(and(eq(siteDesignSystems.siteId, siteId), eq(siteDesignSystems.status, "approved")))
    .orderBy(desc(siteDesignSystems.version))
    .limit(1);
  return ds ?? null;
}
