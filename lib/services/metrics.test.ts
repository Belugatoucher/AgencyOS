import { describe, expect, it } from "vitest";
import { computeWinnerIds } from "./creatives";
import { aggregateMetrics, columnMapping, matchCreativeName } from "./metrics";

const ID_A = "1a2b3c4d-0000-4000-8000-000000000001";
const ID_B = "9f8e7d6c-0000-4000-8000-000000000002";

describe("matchCreativeName", () => {
  it("matches a full uuid embedded in the ad name", () => {
    expect(matchCreativeName(`BF Sale — ${ID_A} — v2`, [ID_A, ID_B])).toBe(ID_A);
  });

  it("matches an 8+ hex-char id-prefix slug", () => {
    expect(matchCreativeName("bf-sale_cr-1a2b3c4d_v2", [ID_A, ID_B])).toBe(ID_A);
  });

  it("returns null when nothing matches", () => {
    expect(matchCreativeName("Evergreen UGC hook 3", [ID_A, ID_B])).toBeNull();
    expect(matchCreativeName("deadbeef99 unrelated slug", [ID_A, ID_B])).toBeNull();
  });
});

describe("aggregateMetrics", () => {
  it("sums numeric keys across rows and derives rates", () => {
    const out = aggregateMetrics([
      { spend: 100, impressions: 10_000, clicks: 200, conversions: 10, revenue: 300, _name: "ad-1" },
      { spend: 50, impressions: 5_000, clicks: 100, conversions: 5, revenue: 150 },
    ]);
    expect(out.spend).toBe(150);
    expect(out.impressions).toBe(15_000);
    expect(out.ctr).toBeCloseTo(300 / 15_000);
    expect(out.cpc).toBeCloseTo(0.5);
    expect(out.cpa).toBeCloseTo(10);
    expect(out.roas).toBeCloseTo(3);
    expect(out._name).toBeUndefined(); // non-numeric keys don't aggregate
  });

  it("omits rates whose denominators are missing", () => {
    const out = aggregateMetrics([{ spend: 100 }]);
    expect(out.ctr).toBeUndefined();
    expect(out.cpc).toBeUndefined();
    expect(out.roas).toBeUndefined();
  });
});

describe("computeWinnerIds", () => {
  const c = (id: string, spendCents: number, roas?: number) => ({
    id,
    spendCents,
    metrics: roas === undefined ? {} : { roas },
  });

  it("flags the top quartile on the primary KPI above the spend floor", () => {
    const rows = [
      c("w", 20_000, 5.0),
      c("a", 20_000, 3.0),
      c("b", 20_000, 2.0),
      c("d", 20_000, 1.0),
    ];
    const winners = computeWinnerIds(rows, "roas", 10_000);
    expect(winners).toEqual(new Set(["w"]));
  });

  it("excludes creatives under the spend floor even with a great KPI", () => {
    const rows = [c("cheap", 500, 99), c("real", 20_000, 2.0)];
    const winners = computeWinnerIds(rows, "roas", 10_000);
    expect(winners.has("cheap")).toBe(false);
    expect(winners.has("real")).toBe(true); // sole eligible = top quartile
  });

  it("returns empty when nothing is eligible", () => {
    expect(computeWinnerIds([c("x", 500, 4), c("y", 20_000)], "roas", 10_000).size).toBe(0);
  });
});

describe("columnMapping", () => {
  it("accepts a saved Meta-export style mapping", () => {
    const r = columnMapping.safeParse({
      externalId: "ad id",
      date: "day",
      name: "ad name",
      metrics: { spend: "amount spent (usd)", impressions: "impressions", clicks: "link clicks" },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.entityKind).toBe("ad");
  });
});
