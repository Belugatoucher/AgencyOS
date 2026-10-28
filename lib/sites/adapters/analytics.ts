import type { AnalyticsSource, MetricSource } from "@/lib/sites/types";

// Analytics sources (docs/18). Declared now so the nightly pull, the
// site_metrics_daily table and the Analytics tab all exist end to end; each
// source reports unavailable until its adapter lands, and the tab says so.
//
// site.settings.analytics shape (set from the site's Settings tab):
//   { gsc?: { property: "sc-domain:example.com" },
//     ga4?: { propertyId: "123456789" },
//     ghl?: { locationId?: string, source?: string } }

function settingsFor(site: { settings: Record<string, unknown> }, id: MetricSource): Record<string, unknown> | null {
  const a = (site.settings.analytics ?? {}) as Record<string, Record<string, unknown> | undefined>;
  return a[id] ?? null;
}

function pending(id: MetricSource, todo: string): AnalyticsSource {
  return {
    id,
    available: () => false,
    async pullDaily() {
      throw new Error(`${id} analytics isn't wired yet — ${todo}`);
    },
  };
}

// TODO(docs/18): Search Console — searchanalytics.query (dimensions: date) for
// clicks/impressions/ctr/position; OAuth refresh token in integration_credentials(provider='google').
export const gscSource = pending("gsc", "Search Console OAuth + searchanalytics.query");
// TODO(docs/18): GA4 Data API runReport (sessions, totalUsers, conversions) for the property.
export const ga4Source = pending("ga4", "GA4 Data API runReport");
// TODO(docs/18): count GHL contacts created that day whose source/attribution URL is on the site's domain.
export const ghlSource = pending("ghl", "GHL contacts by attribution source");

export const ALL_SOURCES: AnalyticsSource[] = [gscSource, ga4Source, ghlSource];

export function configuredSources(site: { id: string; settings: Record<string, unknown> }): AnalyticsSource[] {
  return ALL_SOURCES.filter((s) => settingsFor(site, s.id) && s.available(site));
}
