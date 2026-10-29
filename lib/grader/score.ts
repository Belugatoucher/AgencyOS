// Website grade (docs/18 "Grader"). Pure and deterministic: the same signals
// always give the same score, so a prospect can rerun it after fixes and see
// the number move. No invented numbers — every check is something measured.

import type { HomeSignals } from "./inspect";

export type PsiResult = {
  performance: number; // 0-100
  seo: number;
  accessibility: number;
  bestPractices: number;
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
};

export type SiteCrawlSummary = {
  pages: number;
  missingMeta: number; // pages missing title/description/h1
  thinPages: number; // < 150 words
  brokenLinks: number;
};

export type MapsResult = {
  keyword: string;
  points: number; // grid points checked
  found: boolean; // business found anywhere in the grid
  avgRank: number | null; // average rank where found (1 = top), null when never found
  top3Share: number; // 0-1 share of points where the business is in the map pack
  rating: number | null;
  reviews: number | null;
  competitor: { name: string; domain: string | null; rating: number | null; reviews: number | null; top3Share: number } | null;
  grid: { lat: number; lng: number; rank: number | null }[];
};

export type GradeInput = {
  home: HomeSignals;
  fetchMs: number | null;
  crawl: SiteCrawlSummary;
  psi: PsiResult | null;
  ssl: { valid: boolean; daysLeft: number | null } | null;
  maps: MapsResult | null;
  nowYear: number;
};

export type SectionId = "speed" | "mobile" | "seo" | "trust" | "conversion" | "local";
export type Check = {
  id: string;
  section: SectionId;
  label: string; // what we checked, plain words
  pass: boolean;
  weight: number; // within its section
  impact: 1 | 2 | 3; // how much fixing it matters to getting calls (for the fix list)
  fix: string; // what to do, one sentence
  detail?: string; // the measured value
};
export type Section = { id: SectionId; label: string; score: number; checks: Check[] };
export type Grade = { score: number; letter: "A" | "B" | "C" | "D" | "F"; sections: Section[]; topFixes: Check[]; summary: string };

export const SECTION_LABEL: Record<SectionId, string> = {
  speed: "Speed",
  mobile: "Mobile",
  seo: "Search basics",
  trust: "Trust",
  conversion: "Getting the call",
  local: "Google Maps",
};

// Overall weights. Local (Maps) only counts when it was checked.
const SECTION_WEIGHT: Record<SectionId, number> = { speed: 15, mobile: 15, seo: 20, trust: 15, conversion: 20, local: 15 };

function c(section: SectionId, id: string, label: string, pass: boolean, weight: number, impact: 1 | 2 | 3, fix: string, detail?: string): Check {
  return { id, section, label, pass, weight, impact, fix, detail };
}

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function buildChecks(i: GradeInput): Check[] {
  const h = i.home;
  const out: Check[] = [];

  // Speed
  if (i.psi) {
    out.push(c("speed", "psi-perf", "Google speed score (mobile) is 70+", i.psi.performance >= 70, 3, 3, "Compress images, drop unused scripts and plugins, and serve the site from a fast host.", `${i.psi.performance}/100`));
    if (i.psi.lcpMs != null) out.push(c("speed", "lcp", "Main content shows within 2.5s on a phone", i.psi.lcpMs <= 2500, 2, 2, "Make the first image smaller and load it first; cut render-blocking code.", secs(i.psi.lcpMs)));
    if (i.psi.cls != null) out.push(c("speed", "cls", "Page doesn't jump around while loading", i.psi.cls <= 0.1, 1, 1, "Give images and embeds fixed sizes so the layout doesn't shift.", i.psi.cls.toFixed(2)));
  } else if (i.fetchMs != null) {
    out.push(c("speed", "ttfb", "Server answers in under 1.5s", i.fetchMs <= 1500, 3, 2, "Move to faster hosting or add a CDN.", secs(i.fetchMs)));
  }

  // Mobile
  out.push(c("mobile", "viewport", "Built to fit phone screens", h.viewport, 3, 3, "Add a responsive layout (viewport meta + mobile CSS)."));
  out.push(c("mobile", "tap-call", "Phone number is tap-to-call", h.telLinks > 0, 3, 3, "Make every phone number a tap-to-call link (tel:)."));
  if (i.psi) out.push(c("mobile", "a11y", "Readable and usable (accessibility 85+)", i.psi.accessibility >= 85, 2, 1, "Raise text contrast, label buttons and form fields, and size tap targets for thumbs.", `${i.psi.accessibility}/100`));

  // Search basics
  const tl = h.title?.length ?? 0;
  out.push(c("seo", "title", "Homepage title says what you do and where (30–65 characters)", tl >= 30 && tl <= 65, 3, 2, "Write a title like “Junk Removal in Wooster, OH | Same-Day Pickup”.", h.title ? `${tl} chars: “${h.title.slice(0, 70)}”` : "missing"));
  const dl = h.description?.length ?? 0;
  out.push(c("seo", "description", "Search description written (70–160 characters)", dl >= 70 && dl <= 160, 2, 1, "Write a 1–2 sentence description with your service, town and a reason to call.", h.description ? `${dl} chars` : "missing"));
  out.push(c("seo", "h1", "One clear main headline", h.h1Count === 1, 1, 1, "Use exactly one H1 that names the service and town.", `${h.h1Count} found`));
  out.push(c("seo", "schema", "Business details marked up for Google (LocalBusiness schema)", h.localBusinessSchema, 2, 2, "Add LocalBusiness schema with name, address, phone, hours and service area."));
  out.push(c("seo", "pages", "Separate pages for services and towns (5+ pages)", i.crawl.pages >= 5, 3, 3, "Add one page per main service and per town you serve — that's what ranks for “service + town” searches.", `${i.crawl.pages} page${i.crawl.pages === 1 ? "" : "s"} found`));
  if (i.crawl.pages > 0) {
    out.push(c("seo", "meta-all", "Every page has a title, description and headline", i.crawl.missingMeta === 0, 1, 1, "Fill in the title, description and H1 on each page.", `${i.crawl.missingMeta} page${i.crawl.missingMeta === 1 ? "" : "s"} missing some`));
    out.push(c("seo", "thin", "Pages have real content (150+ words)", i.crawl.thinPages <= Math.floor(i.crawl.pages / 3), 1, 1, "Expand thin pages with what you do, where, pricing signals and FAQs.", `${i.crawl.thinPages} thin`));
  }
  if (h.images > 0) out.push(c("seo", "alts", "Images are described for Google (alt text)", h.imagesWithAlt / h.images >= 0.8, 1, 1, "Add short alt text to photos, e.g. “dumpster drop-off in Orrville”.", `${h.imagesWithAlt}/${h.images}`));
  if (i.psi) out.push(c("seo", "psi-seo", "Google's own SEO check passes (90+)", i.psi.seo >= 90, 1, 1, "Fix the issues Google lists: crawlable links, valid robots, page titles.", `${i.psi.seo}/100`));

  // Trust
  out.push(c("trust", "https", "Secure (https) with a valid certificate", h.https && (i.ssl?.valid ?? true), 3, 3, "Turn on HTTPS — browsers warn visitors away from insecure sites.", i.ssl?.daysLeft != null ? `expires in ${i.ssl.daysLeft} days` : undefined));
  out.push(c("trust", "reviews", "Shows reviews or testimonials", h.reviewsMentioned || h.ratingSchema, 3, 3, "Put your best Google reviews on the homepage, near the call button."));
  out.push(c("trust", "nap", "Shows a phone number and address/service area", h.phoneInText && (h.addressLike || h.mapEmbed), 2, 2, "List your phone, address or service area in the header or footer on every page."));
  out.push(c("trust", "fresh", "Looks current (copyright year this year or last)", h.copyrightYear != null && h.copyrightYear >= i.nowYear - 1, 1, 1, "Update the footer year — an old year makes people wonder if you're still open.", h.copyrightYear ? String(h.copyrightYear) : "no year"));
  out.push(c("trust", "broken", "No broken links", i.crawl.brokenLinks === 0, 2, 2, "Fix or remove links that lead to error pages.", `${i.crawl.brokenLinks} broken`));

  // Conversion
  out.push(c("conversion", "phone-early", "Phone number visible right away (header or first screen)", h.phoneEarly, 3, 3, "Put the phone number in the header and the first screen — most service calls start there."));
  out.push(c("conversion", "form", "Has a quote / contact form", h.forms > 0, 3, 3, "Add a short quote form (name, phone, what you need) on the homepage."));
  out.push(c("conversion", "cta", "Clear call to action (quote, call, book)", h.ctaHits.length > 0, 2, 2, "Use one action everywhere, like “Get a free quote” or “Call now”.", h.ctaHits.length ? h.ctaHits.join(", ") : "none found"));
  out.push(c("conversion", "area", "Shows where you work (map or service area)", h.mapEmbed || h.addressLike, 1, 1, "Add a service-area section or map so people know you cover their town."));

  // Local (Google Maps grid)
  if (i.maps) {
    const m = i.maps;
    out.push(c("local", "maps-found", `Shows up in Google Maps for “${m.keyword}”`, m.found, 3, 3, "Claim and complete your Google Business Profile: category, services, service area, photos.", m.found ? `found at ${m.grid.filter((g) => g.rank != null).length} of ${m.points} spots` : "not found at any spot"));
    out.push(c("local", "maps-top3", "In the top 3 (the map pack) across most of town", m.top3Share >= 0.5, 3, 3, "Get more reviews, post weekly, and add the town to your profile and site pages.", `${Math.round(m.top3Share * 100)}% of the area`));
    if (m.rating != null) out.push(c("local", "rating", "Rated 4.5★ or better", m.rating >= 4.5, 1, 2, "Ask every happy customer for a review with a direct link.", `${m.rating}★`));
    if (m.reviews != null && m.competitor?.reviews != null)
      out.push(c("local", "reviews-vs", "As many reviews as the top competitor", m.reviews >= m.competitor.reviews, 2, 2, "Set up an automatic review request after every job.", `${m.reviews} vs ${m.competitor.reviews}`));
  }
  return out;
}

export function letterFor(score: number): Grade["letter"] {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

export function grade(input: GradeInput): Grade {
  const checks = buildChecks(input);
  const ids = [...new Set(checks.map((x) => x.section))];
  const sections: Section[] = (["speed", "mobile", "seo", "trust", "conversion", "local"] as SectionId[])
    .filter((id) => ids.includes(id))
    .map((id) => {
      const list = checks.filter((x) => x.section === id);
      const total = list.reduce((a, x) => a + x.weight, 0);
      const got = list.filter((x) => x.pass).reduce((a, x) => a + x.weight, 0);
      return { id, label: SECTION_LABEL[id], score: total ? Math.round((got / total) * 100) : 0, checks: list };
    });
  const wTotal = sections.reduce((a, s) => a + SECTION_WEIGHT[s.id], 0);
  const score = wTotal ? Math.round(sections.reduce((a, s) => a + s.score * SECTION_WEIGHT[s.id], 0) / wTotal) : 0;
  const topFixes = checks
    .filter((x) => !x.pass)
    .sort((a, b) => b.impact - a.impact || b.weight - a.weight || SECTION_WEIGHT[b.section] - SECTION_WEIGHT[a.section])
    .slice(0, 5);
  const weakest = [...sections].sort((a, b) => a.score - b.score)[0];
  const summary =
    topFixes.length === 0
      ? "This site does the basics well. The next gains come from more pages per service and town, and more reviews."
      : `Scored ${score}/100. The biggest gap is ${weakest ? weakest.label.toLowerCase() : "the basics"}: ${topFixes[0]!.fix.charAt(0).toLowerCase()}${topFixes[0]!.fix.slice(1)}`;
  return { score, letter: letterFor(score), sections, topFixes, summary };
}
