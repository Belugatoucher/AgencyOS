import { describe, expect, it } from "vitest";
import { findRank, gridPoints, normalizeDomain, summarizeGrid, type MapsPlace } from "./grid";
import { detectPlatform, inspectHomepage } from "./inspect";
import { grade, letterFor, type GradeInput } from "./score";

const goodHtml = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Junk Removal in Wooster, OH | Same-Day Pickup</title>
<meta name="description" content="Same-day junk removal and dumpster rental in Wooster and Wayne County. Upfront pricing, licensed and insured. Call for a free quote today.">
<link rel="canonical" href="https://graniteoak.example/"><link rel="icon" href="/favicon.png">
<meta property="og:image" content="https://graniteoak.example/og.jpg">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"HomeAndConstructionBusiness","name":"Granite Oak","aggregateRating":{"@type":"AggregateRating","ratingValue":"4.9","reviewCount":"87"}}</script>
</head><body>
<header><a href="tel:+13305551234">(330) 555-1234</a> <a href="/quote">Get a free quote</a></header>
<h1>Junk removal in Wooster, done today</h1>
<p>We haul furniture, appliances and construction debris across Wayne County.</p>
<img src="/truck.jpg" alt="Granite Oak truck in Wooster"><img src="/crew.jpg" alt="Crew loading a dumpster">
<section><h2>What our customers say</h2><p>★★★★★ Fast and fair.</p></section>
<form action="/quote"><input name="name"><input type="submit" value="Request a quote"></form>
<p>Find us at 201 E Liberty St, Wooster</p>
<iframe src="https://www.google.com/maps/embed?pb=x"></iframe>
<footer>© 2026 Granite Oak Waste Solutions</footer>
</body></html>`;

const badHtml = `<html><head><title>Home</title><meta name="generator" content="Wix.com Website Builder"></head>
<body><h1>Welcome</h1><h1>To our site</h1><p>We do many things. Call 330 555 1234 sometime.</p><img src="a.jpg"><footer>Copyright 2019</footer></body></html>`;

describe("inspectHomepage", () => {
  const g = inspectHomepage(goodHtml, "https://graniteoak.example/");
  it("reads conversion signals", () => {
    expect(g.telLinks).toBe(1);
    expect(g.phoneEarly).toBe(true);
    expect(g.forms).toBe(1);
    expect(g.ctaHits).toEqual(["free quote", "get a quote"]);
  });
  it("reads trust + search signals", () => {
    expect(g.localBusinessSchema).toBe(true);
    expect(g.ratingSchema).toBe(true);
    expect(g.reviewsMentioned).toBe(true);
    expect(g.addressLike).toBe(true);
    expect(g.mapEmbed).toBe(true);
    expect(g.copyrightYear).toBe(2026);
    expect(g.h1Count).toBe(1);
    expect(g.imagesWithAlt).toBe(2);
  });
  it("flags a weak builder site", () => {
    const b = inspectHomepage(badHtml, "http://oldsite.example/");
    expect(b.https).toBe(false);
    expect(b.viewport).toBe(false);
    expect(b.telLinks).toBe(0);
    expect(b.phoneInText).toBe(true);
    expect(b.h1Count).toBe(2);
    expect(b.copyrightYear).toBe(2019);
    expect(b.platform).toBe("wix");
  });
  it("detects common platforms", () => {
    expect(detectPlatform('<link href="/wp-content/themes/x.css">')).toBe("wordpress");
    expect(detectPlatform('<img src="https://img1.wsimg.com/x.jpg">')).toBe("godaddy");
    expect(detectPlatform("<p>plain</p>")).toBe(null);
  });
});

const baseInput = (home: ReturnType<typeof inspectHomepage>): GradeInput => ({
  home,
  fetchMs: 600,
  crawl: { pages: 8, missingMeta: 0, thinPages: 1, brokenLinks: 0 },
  psi: { performance: 92, seo: 100, accessibility: 95, bestPractices: 96, lcpMs: 1800, cls: 0.02, tbtMs: 50 },
  ssl: { valid: true, daysLeft: 70 },
  maps: null,
  nowYear: 2026,
});

describe("grade", () => {
  it("gives a strong site an A with nothing urgent", () => {
    const g = grade(baseInput(inspectHomepage(goodHtml, "https://graniteoak.example/")));
    expect(g.letter).toBe("A");
    expect(g.sections.map((s) => s.id)).toEqual(["speed", "mobile", "seo", "trust", "conversion"]);
    expect(g.topFixes.every((f) => f.impact < 3)).toBe(true);
  });

  it("fails a weak site and leads with the fixes that cost calls", () => {
    const weak = baseInput(inspectHomepage(badHtml, "http://oldsite.example/"));
    weak.psi = { performance: 31, seo: 70, accessibility: 60, bestPractices: 70, lcpMs: 7100, cls: 0.4, tbtMs: 900 };
    weak.crawl = { pages: 1, missingMeta: 1, thinPages: 1, brokenLinks: 3 };
    weak.ssl = null;
    const g = grade(weak);
    expect(g.letter).toBe("F");
    expect(g.topFixes.length).toBe(5);
    expect(g.topFixes.every((f) => f.impact === 3)).toBe(true);
    expect(g.summary.startsWith(`Scored ${g.score}/100.`)).toBe(true);
  });

  it("adds a Google Maps section only when the grid was checked", () => {
    const input = baseInput(inspectHomepage(goodHtml, "https://graniteoak.example/"));
    input.maps = {
      keyword: "junk removal",
      points: 25,
      found: true,
      avgRank: 5.2,
      top3Share: 0.2,
      rating: 4.9,
      reviews: 40,
      competitor: { name: "Haul-It", domain: "haulit.example", rating: 4.7, reviews: 210, top3Share: 0.8 },
      grid: Array.from({ length: 25 }, (_, i) => ({ lat: 0, lng: i, rank: i < 18 ? 6 : null })),
    };
    const g = grade(input);
    const local = g.sections.find((s) => s.id === "local")!;
    expect(local.checks.find((c) => c.id === "maps-found")!.detail).toBe("found at 18 of 25 spots");
    expect(local.checks.find((c) => c.id === "maps-top3")!.pass).toBe(false);
    expect(local.checks.find((c) => c.id === "reviews-vs")!.detail).toBe("40 vs 210");
  });

  it("maps scores to letters", () => {
    expect([95, 85, 75, 65, 40].map(letterFor)).toEqual(["A", "B", "C", "D", "F"]);
  });
});

const place = (o: Partial<MapsPlace>): MapsPlace => ({ title: "X", domain: null, placeId: null, cid: null, rank: 1, rating: null, reviews: null, lat: null, lng: null, ...o });

describe("maps grid", () => {
  it("lays out an odd square grid around the centre", () => {
    const pts = gridPoints(40.8, -81.9, 5, 1);
    expect(pts.length).toBe(25);
    expect(pts[12]).toEqual({ lat: 40.8, lng: -81.9 });
    expect(gridPoints(40.8, -81.9, 4, 1).length).toBe(25); // even sizes round up
  });

  it("matches the business by place id, then domain, then name", () => {
    const list = [place({ title: "Haul-It", rank: 1 }), place({ title: "Granite Oak Waste", domain: "www.graniteoak.example", rank: 2 })];
    expect(findRank(list, { placeId: null, cid: null, domain: "https://graniteoak.example/", name: "Nope" })).toBe(2);
    expect(findRank(list, { placeId: null, cid: null, domain: null, name: "granite oak waste" })).toBe(2);
    expect(findRank(list, { placeId: "p9", cid: null, domain: null, name: "Other" })).toBe(null);
    expect(normalizeDomain("https://WWW.Example.com/path")).toBe("example.com");
  });

  it("summarises coverage and names the competitor who holds #1 most", () => {
    const me = { title: "Granite Oak", placeId: "me" };
    const rival = { title: "Haul-It", placeId: "r1", rating: 4.7, reviews: 210 };
    const pts = [
      { lat: 1, lng: 1, results: [place({ ...rival, rank: 1 }), place({ ...me, rank: 2 })] },
      { lat: 1, lng: 2, results: [place({ ...rival, rank: 1 }), place({ title: "Other", placeId: "o", rank: 2 })] },
      { lat: 1, lng: 3, results: [place({ ...me, rank: 1 }), place({ ...rival, rank: 2 })] },
      { lat: 1, lng: 4, results: [place({ ...rival, rank: 1 }), place({ ...me, rank: 5 })] },
    ];
    const s = summarizeGrid(pts, { placeId: "me", cid: null, domain: null, name: "Granite Oak" });
    expect(s.found).toBe(true);
    expect(s.avgRank).toBe(2.7);
    expect(s.top3Share).toBe(0.5);
    expect(s.grid.map((g) => g.rank)).toEqual([2, null, 1, 5]);
    expect(s.competitor).toEqual({ name: "Haul-It", domain: null, rating: 4.7, reviews: 210, top3Share: 1 });
  });
});
