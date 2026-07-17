import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { canMutateAccount, canViewAccount, isInternal, type Viewer } from "@/lib/access";
import { db } from "@/lib/db";
import {
  accounts,
  creatives,
  memberships,
  metricRows,
  metricSources,
  users,
  type MetricRow,
  type MetricSource,
} from "@/lib/db/schema";
import { err, ok, type Result } from "@/lib/result";
import { parseCsv } from "@/lib/services/lead-intake";
import { notify } from "@/lib/services/notifications";
import { recomputeWinning } from "@/lib/services/creatives";

// Metrics ingestion (docs/09): CSV first; the same rows later arrive from GHL
// and the Meta adapter (v1.5). Everything lands in metric_rows and rolls up.

export const METRIC_SOURCE_KINDS = ["meta", "tiktok", "ga4", "ghl", "csv"] as const;
export const ENTITY_KINDS = ["ad", "adset", "campaign", "post"] as const;

// Column mapping (saved per source in config): CSV header → our field. The
// metric columns map to keys inside metric_rows.metrics (spend in currency
// units; we keep raw numbers and convert at rollup).
export const columnMapping = z.object({
  externalId: z.string().min(1).max(100),
  date: z.string().min(1).max(100),
  name: z.string().max(100).optional(), // ad name — used for creative matching
  entityKind: z.enum(ENTITY_KINDS).default("ad"),
  metrics: z.record(z.string().max(50), z.string().max(100)).default({}), // ourKey → csv header
});
export type ColumnMapping = z.infer<typeof columnMapping>;

export const metricSourceInput = z.object({
  accountId: z.string().uuid(),
  kind: z.enum(METRIC_SOURCE_KINDS),
  mapping: columnMapping.nullish(),
});

function guard(viewer: Viewer, accountId: string, mutate = false): Result<true> {
  if (!isInternal(viewer)) return err("forbidden", "Metrics are internal");
  if (!canViewAccount(viewer, accountId)) return err("not_found", "Account not found");
  if (mutate && !canMutateAccount(viewer, accountId)) return err("forbidden", "Only the team can import metrics");
  return ok(true);
}

export async function createMetricSource(
  viewer: Viewer,
  input: z.infer<typeof metricSourceInput>,
): Promise<Result<MetricSource>> {
  const g = guard(viewer, input.accountId, true);
  if (!g.ok) return g as Result<never>;
  const [row] = await db
    .insert(metricSources)
    .values({
      accountId: input.accountId,
      kind: input.kind,
      config: input.mapping ? { mapping: input.mapping } : {},
    })
    .returning();
  return ok(row!);
}

export async function listMetricSources(viewer: Viewer, accountId: string): Promise<Result<MetricSource[]>> {
  const g = guard(viewer, accountId);
  if (!g.ok) return g as Result<never>;
  return ok(
    await db
      .select()
      .from(metricSources)
      .where(eq(metricSources.accountId, accountId))
      .orderBy(desc(metricSources.createdAt)),
  );
}

function toNumber(raw: string | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw.replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function toIsoDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Ad → creative matching (docs/09): the SOP puts the creative id (full uuid or
 * its first 8+ hex chars) in the ad name. DECISION: creatives carry no name
 * field, so the "fuzzy name match" fallback has nothing to match against in
 * v1 — id-slug match + the manual link endpoint cover it; unmatched spend
 * surfaces in the weekly digest so nothing rots silently.
 */
export function matchCreativeName(adName: string, creativeIds: string[]): string | null {
  const uuidMatch = adName.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (uuidMatch) {
    const hit = creativeIds.find((id) => id === uuidMatch[0]!.toLowerCase());
    if (hit) return hit;
  }
  // 8+ hex-char prefix slug, delimited (e.g. "BF-Sale_cr-1a2b3c4d_v2")
  const slugs = adName.toLowerCase().match(/[0-9a-f]{8,}/g) ?? [];
  for (const slug of slugs) {
    const hit = creativeIds.find((id) => id.replaceAll("-", "").startsWith(slug));
    if (hit) return hit;
  }
  return null;
}

export async function matchCreativeByName(accountId: string, adName: string): Promise<string | null> {
  const accountCreatives = await db
    .select({ id: creatives.id })
    .from(creatives)
    .where(eq(creatives.accountId, accountId));
  return matchCreativeName(adName, accountCreatives.map((c) => c.id));
}

export type ImportSummary = { imported: number; skipped: number; matched: number };

/**
 * CSV import (docs/09): mapping-driven, idempotent — upsert on
 * (source_id, external_id, date). The mapping used is saved back onto the
 * source config so re-imports don't re-map.
 */
export async function importMetricsCsv(
  viewer: Viewer,
  sourceId: string,
  csvText: string,
  mappingOverride?: ColumnMapping,
): Promise<Result<ImportSummary>> {
  const [source] = await db.select().from(metricSources).where(eq(metricSources.id, sourceId));
  if (!source) return err("not_found", "Metric source not found");
  const g = guard(viewer, source.accountId, true);
  if (!g.ok) return g as Result<never>;

  const saved = (source.config as { mapping?: ColumnMapping }).mapping;
  const mapping = mappingOverride ?? saved;
  if (!mapping) return err("invalid", "No column mapping: provide one with the first import");

  const rows = parseCsv(csvText).slice(0, 10_000);
  let imported = 0;
  let skipped = 0;
  let matched = 0;
  for (const raw of rows) {
    const externalId = raw[mapping.externalId.toLowerCase()]?.trim();
    const date = toIsoDate(raw[mapping.date.toLowerCase()]);
    if (!externalId || !date) {
      skipped++;
      continue;
    }
    const metrics: Record<string, number | string> = {};
    for (const [ourKey, header] of Object.entries(mapping.metrics)) {
      const n = toNumber(raw[header.toLowerCase()]);
      if (n !== null) metrics[ourKey] = n;
    }
    const name = mapping.name ? raw[mapping.name.toLowerCase()]?.trim() : undefined;
    if (name) metrics._name = name;

    let creativeMatch: string | null = null;
    if (name && mapping.entityKind === "ad") {
      creativeMatch = await matchCreativeByName(source.accountId, name);
      if (creativeMatch) matched++;
    }

    await db
      .insert(metricRows)
      .values({
        sourceId,
        externalId,
        entityKind: mapping.entityKind,
        date,
        metrics,
        creativeMatch,
      })
      .onConflictDoUpdate({
        target: [metricRows.sourceId, metricRows.externalId, metricRows.date],
        set: {
          metrics,
          // re-import refreshes numbers but never clobbers a manual link
          ...(creativeMatch ? { creativeMatch } : {}),
        },
      });
    imported++;
  }

  await db
    .update(metricSources)
    .set({ config: { ...(source.config as object), mapping }, lastPulledAt: new Date() })
    .where(eq(metricSources.id, sourceId));
  return ok({ imported, skipped, matched });
}

/** Manual ad↔creative link (docs/09 "manual link UI for stragglers"). */
export async function linkMetricRow(
  viewer: Viewer,
  rowId: string,
  creativeId: string | null,
): Promise<Result<MetricRow>> {
  const [row] = await db
    .select({ row: metricRows, accountId: metricSources.accountId })
    .from(metricRows)
    .innerJoin(metricSources, eq(metricSources.id, metricRows.sourceId))
    .where(eq(metricRows.id, rowId));
  if (!row) return err("not_found", "Metric row not found");
  const g = guard(viewer, row.accountId, true);
  if (!g.ok) return g as Result<never>;
  if (creativeId) {
    const [creative] = await db.select().from(creatives).where(eq(creatives.id, creativeId));
    if (!creative || creative.accountId !== row.accountId) return err("not_found", "Creative not found");
  }
  const [updated] = await db
    .update(metricRows)
    .set({ creativeMatch: creativeId })
    .where(eq(metricRows.id, rowId))
    .returning();
  return ok(updated!);
}

export async function listUnmatched(viewer: Viewer, accountId: string): Promise<Result<MetricRow[]>> {
  const g = guard(viewer, accountId);
  if (!g.ok) return g as Result<never>;
  const rows = await db
    .select({ row: metricRows })
    .from(metricRows)
    .innerJoin(metricSources, eq(metricSources.id, metricRows.sourceId))
    .where(
      and(
        eq(metricSources.accountId, accountId),
        eq(metricRows.entityKind, "ad"),
        isNull(metricRows.creativeMatch),
      ),
    )
    .orderBy(desc(metricRows.date))
    .limit(200);
  return ok(rows.map((r) => r.row));
}

// ---- Nightly rollup (docs/09): metric_rows → creatives.metrics + is_winning ----

/** Sum numeric metric keys, then derive standard rates (ctr, cpc, cpa, roas). */
export function aggregateMetrics(rowMetrics: Record<string, unknown>[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const m of rowMetrics) {
    for (const [k, v] of Object.entries(m)) {
      if (typeof v === "number") totals[k] = (totals[k] ?? 0) + v;
    }
  }
  const spend = totals.spend ?? 0;
  const rates: Record<string, number> = {};
  if (totals.impressions) rates.ctr = (totals.clicks ?? 0) / totals.impressions;
  if (totals.clicks) rates.cpc = spend / totals.clicks;
  if (totals.conversions) rates.cpa = spend / totals.conversions;
  if (spend > 0 && totals.revenue != null) rates.roas = totals.revenue / spend;
  return { ...totals, ...rates };
}

/**
 * Aggregate matched rows per creative: totals for every numeric metric key,
 * then derived rates from the standard keys. Spend is imported in currency
 * units; creatives.spend_cents gets the cents.
 */
export async function rollupAccount(accountId: string): Promise<{ creatives: number; winners: number }> {
  const rows = await db
    .select({ row: metricRows })
    .from(metricRows)
    .innerJoin(metricSources, eq(metricSources.id, metricRows.sourceId))
    .where(and(eq(metricSources.accountId, accountId), sql`${metricRows.creativeMatch} is not null`));

  const byCreative = new Map<string, Record<string, unknown>[]>();
  for (const { row } of rows) {
    const list = byCreative.get(row.creativeMatch!) ?? [];
    list.push(row.metrics as Record<string, unknown>);
    byCreative.set(row.creativeMatch!, list);
  }

  for (const [creativeId, rowMetrics] of byCreative) {
    const metrics = aggregateMetrics(rowMetrics);
    await db
      .update(creatives)
      .set({ metrics, spendCents: Math.round((metrics.spend ?? 0) * 100) })
      .where(eq(creatives.id, creativeId));
  }

  const { winners } = await recomputeWinning(accountId);
  return { creatives: byCreative.size, winners };
}

/** Cron: roll up every account that has metric sources. */
export async function rollupAllAccounts(): Promise<{ accounts: number }> {
  const rows = await db
    .selectDistinct({ accountId: metricSources.accountId })
    .from(metricSources);
  for (const { accountId } of rows) await rollupAccount(accountId);
  return { accounts: rows.length };
}

/**
 * Weekly digest (docs/09): unmatched ad spend per account, notified to the
 * account's internal members so it never silently rots.
 */
export async function unmatchedSpendDigest(): Promise<{ accounts: number }> {
  const rows = await db
    .select({
      accountId: metricSources.accountId,
      accountName: accounts.name,
      spend: sql<number>`coalesce(sum((${metricRows.metrics}->>'spend')::numeric), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(metricRows)
    .innerJoin(metricSources, eq(metricSources.id, metricRows.sourceId))
    .innerJoin(accounts, eq(accounts.id, metricSources.accountId))
    .where(and(eq(metricRows.entityKind, "ad"), isNull(metricRows.creativeMatch)))
    .groupBy(metricSources.accountId, accounts.name);

  let notified = 0;
  for (const r of rows) {
    if (Number(r.count) === 0) continue;
    const members = await db
      .select({ id: users.id })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.accountId, r.accountId), ne(users.role, "client")));
    await notify(
      members.map((m) => m.id),
      {
        kind: "unmatched_spend",
        body: { accountId: r.accountId, account: r.accountName, rows: Number(r.count), spend: Number(r.spend) },
        slackText: `📊 ${r.accountName}: $${Number(r.spend).toFixed(2)} of ad spend across ${r.count} rows has no creative match`,
      },
    );
    notified++;
  }
  return { accounts: notified };
}
