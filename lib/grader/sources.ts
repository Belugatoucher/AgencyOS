import { gridPoints, summarizeGrid, type GridSummary, type MapsPlace, type Target } from "./grid";
import type { PsiResult } from "./score";

// External data for the grader (docs/18 "Grader"):
//  - PageSpeed Insights (Google's Lighthouse, mobile): PAGESPEED_API_KEY. Free quota.
//  - DataForSEO Google Maps (live/advanced): DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD,
//    pay-as-you-go on Ryan's own account (~1 request per grid point + 1 to locate).
// Both are optional: the grade works without them and the report says which
// parts weren't checked.

export function psiConfigured(): boolean {
  return Boolean(process.env.PAGESPEED_API_KEY);
}

export async function runPsi(url: string): Promise<PsiResult | null> {
  if (!psiConfigured()) return null;
  const api = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  api.searchParams.set("url", url);
  api.searchParams.set("strategy", "mobile");
  for (const cat of ["performance", "seo", "accessibility", "best-practices"]) api.searchParams.append("category", cat);
  api.searchParams.set("key", process.env.PAGESPEED_API_KEY!);
  const res = await fetch(api, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`PageSpeed returned ${res.status}`);
  const j = (await res.json()) as {
    lighthouseResult?: {
      categories?: Record<string, { score?: number | null }>;
      audits?: Record<string, { numericValue?: number }>;
    };
  };
  const cats = j.lighthouseResult?.categories ?? {};
  const audits = j.lighthouseResult?.audits ?? {};
  const pct = (k: string) => Math.round((cats[k]?.score ?? 0) * 100);
  return {
    performance: pct("performance"),
    seo: pct("seo"),
    accessibility: pct("accessibility"),
    bestPractices: pct("best-practices"),
    lcpMs: audits["largest-contentful-paint"]?.numericValue ?? null,
    cls: audits["cumulative-layout-shift"]?.numericValue ?? null,
    tbtMs: audits["total-blocking-time"]?.numericValue ?? null,
  };
}

// ---------- DataForSEO Maps ----------

export function mapsConfigured(): boolean {
  return Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
}

type DfsItem = {
  type?: string;
  rank_group?: number;
  title?: string;
  domain?: string | null;
  place_id?: string | null;
  cid?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  rating?: { value?: number | null; votes_count?: number | null } | null;
};

async function mapsSearch(task: Record<string, unknown>): Promise<MapsPlace[]> {
  const auth = Buffer.from(`${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`).toString("base64");
  const res = await fetch("https://api.dataforseo.com/v3/serp/google/maps/live/advanced", {
    method: "POST",
    headers: { authorization: `Basic ${auth}`, "content-type": "application/json" },
    body: JSON.stringify([{ language_code: "en", depth: 20, device: "mobile", ...task }]),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`DataForSEO returned ${res.status}`);
  const j = (await res.json()) as { status_code?: number; status_message?: string; tasks?: { status_code?: number; status_message?: string; result?: { items?: DfsItem[] }[] }[] };
  const t = j.tasks?.[0];
  if (!t || (t.status_code && t.status_code >= 40000)) throw new Error(`DataForSEO: ${t?.status_message ?? j.status_message ?? "no task"}`);
  return (t.result?.[0]?.items ?? [])
    .filter((i) => i.type === "maps_search")
    .map((i) => ({
      title: i.title ?? "",
      domain: i.domain ?? null,
      placeId: i.place_id ?? null,
      cid: i.cid ?? null,
      rank: i.rank_group ?? 99,
      rating: i.rating?.value ?? null,
      reviews: i.rating?.votes_count ?? null,
      lat: i.latitude ?? null,
      lng: i.longitude ?? null,
    }));
}

export type MapsCheckInput = { businessName: string; city: string; keyword: string; domain: string | null; size?: number; spacingMiles?: number };

export type MapsCheck = GridSummary & { keyword: string; rating: number | null; reviews: number | null; located: MapsPlace | null; requests: number };

/**
 * Locate the business (one search for "name city"), then check the keyword at
 * each grid point around it. Returns null when the business can't be located.
 */
export async function runMapsGrid(input: MapsCheckInput): Promise<MapsCheck | null> {
  if (!mapsConfigured()) return null;
  const located = (await mapsSearch({ keyword: `${input.businessName} ${input.city}`, location_code: 2840, depth: 10 })).find(
    (p) => p.lat != null && p.lng != null,
  );
  if (!located) return null;
  const target: Target = { placeId: located.placeId, cid: located.cid, domain: input.domain ?? located.domain, name: located.title || input.businessName };
  const pts = gridPoints(located.lat!, located.lng!, input.size ?? 5, input.spacingMiles ?? 1);

  const results: { lat: number; lng: number; results: MapsPlace[] }[] = [];
  const queue = [...pts];
  await Promise.all(
    Array.from({ length: 5 }, async () => {
      for (let p = queue.shift(); p; p = queue.shift()) {
        try {
          results.push({ ...p, results: await mapsSearch({ keyword: input.keyword, location_coordinate: `${p.lat},${p.lng},14z` }) });
        } catch {
          results.push({ ...p, results: [] }); // one failed point shouldn't sink the report
        }
      }
    }),
  );
  // keep the grid's visual order (row by row) regardless of completion order
  results.sort((a, b) => pts.findIndex((p) => p.lat === a.lat && p.lng === a.lng) - pts.findIndex((p) => p.lat === b.lat && p.lng === b.lng));
  return { ...summarizeGrid(results, target), keyword: input.keyword, rating: located.rating, reviews: located.reviews, located, requests: pts.length + 1 };
}
