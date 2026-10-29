// Google Maps grid math (docs/18 "Grader"). Pure, tested in grid.test.ts.
// The adapter (lib/grader/maps.ts) asks DataForSEO for the Maps results at
// each grid point; this module lays out the grid, finds the business in each
// result list, and summarises where it does and doesn't show up.

export type MapsPlace = {
  title: string;
  domain: string | null;
  placeId: string | null;
  cid: string | null;
  rank: number; // 1-based rank_group among organic Maps results
  rating: number | null;
  reviews: number | null;
  lat: number | null;
  lng: number | null;
};

export type Target = { placeId: string | null; cid: string | null; domain: string | null; name: string };

const MILE_LAT = 1 / 69.0;

/** size×size points centred on (lat,lng), spacing in miles. size is odd (3, 5, 7). */
export function gridPoints(lat: number, lng: number, size: number, spacingMiles: number): { lat: number; lng: number }[] {
  const n = Math.max(1, size % 2 === 0 ? size + 1 : size);
  const half = (n - 1) / 2;
  const dLat = spacingMiles * MILE_LAT;
  const dLng = (spacingMiles * MILE_LAT) / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const out: { lat: number; lng: number }[] = [];
  for (let r = half; r >= -half; r--) for (let c = -half; c <= half; c++) out.push({ lat: round7(lat + r * dLat), lng: round7(lng + c * dLng) });
  return out;
}

const round7 = (n: number) => Math.round(n * 1e7) / 1e7;

export function normalizeDomain(d: string | null | undefined): string | null {
  if (!d) return null;
  const host = d.replace(/^https?:\/\//, "").split("/")[0]!.toLowerCase();
  return host.replace(/^www\./, "") || null;
}

const normName = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();

/** The business's rank in one result list: place id / cid first, then domain, then exact name. */
export function findRank(results: MapsPlace[], t: Target): number | null {
  const domain = normalizeDomain(t.domain);
  const name = normName(t.name);
  const hit =
    results.find((r) => (t.placeId && r.placeId === t.placeId) || (t.cid && r.cid === t.cid)) ??
    (domain ? results.find((r) => normalizeDomain(r.domain) === domain) : undefined) ??
    results.find((r) => normName(r.title) === name);
  return hit ? hit.rank : null;
}

export type GridSummary = {
  points: number;
  found: boolean;
  avgRank: number | null;
  top3Share: number;
  grid: { lat: number; lng: number; rank: number | null }[];
  competitor: { name: string; domain: string | null; rating: number | null; reviews: number | null; top3Share: number } | null;
};

/** Summarise the grid; the competitor is whoever else holds #1 most often. */
export function summarizeGrid(points: { lat: number; lng: number; results: MapsPlace[] }[], t: Target): GridSummary {
  const grid = points.map((p) => ({ lat: p.lat, lng: p.lng, rank: findRank(p.results, t) }));
  const ranks = grid.map((g) => g.rank).filter((r): r is number => r != null);
  const top3 = grid.filter((g) => g.rank != null && g.rank <= 3).length;

  const tally = new Map<string, { place: MapsPlace; first: number; top3: number }>();
  for (const p of points) {
    for (const r of p.results) {
      if (findRank([r], t) != null) continue; // that's the business itself
      const key = r.placeId ?? r.cid ?? normName(r.title);
      const cur = tally.get(key) ?? { place: r, first: 0, top3: 0 };
      if (r.rank === 1) cur.first++;
      if (r.rank <= 3) cur.top3++;
      tally.set(key, cur);
    }
  }
  const best = [...tally.values()].sort((a, b) => b.first - a.first || b.top3 - a.top3)[0];

  return {
    points: grid.length,
    found: ranks.length > 0,
    avgRank: ranks.length ? Math.round((ranks.reduce((a, b) => a + b, 0) / ranks.length) * 10) / 10 : null,
    top3Share: grid.length ? Math.round((top3 / grid.length) * 100) / 100 : 0,
    grid,
    competitor: best
      ? {
          name: best.place.title,
          domain: normalizeDomain(best.place.domain),
          rating: best.place.rating,
          reviews: best.place.reviews,
          top3Share: Math.round((best.top3 / Math.max(1, grid.length)) * 100) / 100,
        }
      : null,
  };
}
