// Homepage inspection for the website grader (docs/18 "Grader"). Pure — no
// app imports — so it is unit-tested directly (inspect.test.ts). It reads the
// raw HTML the way a customer and Google would: can I call, can I trust them,
// can I find what they do and where.

import { parsePage } from "../sites/adapters/html";

export type HomeSignals = {
  url: string;
  https: boolean;
  viewport: boolean;
  title: string | null;
  description: string | null;
  h1Count: number;
  h1: string | null;
  canonical: boolean;
  ogImage: boolean;
  favicon: boolean;
  schemaTypes: string[]; // JSON-LD @type values
  localBusinessSchema: boolean;
  ratingSchema: boolean;
  telLinks: number;
  phoneInText: boolean;
  phoneEarly: boolean; // a phone number in the first ~15% of visible text (header / hero)
  forms: number;
  ctaHits: string[]; // distinct call-to-action phrases found in links/buttons
  reviewsMentioned: boolean;
  mapEmbed: boolean;
  addressLike: boolean;
  copyrightYear: number | null;
  wordCount: number;
  images: number;
  imagesWithAlt: number;
  platform: string | null; // wix | squarespace | wordpress | godaddy | weebly | shopify | duda | ghl | null
};

const PHONE = /(\+?1[\s.-]?)?\(?\b[2-9]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
const CTA_PATTERNS: [string, RegExp][] = [
  ["free quote", /free\s+(quote|estimate)/i],
  ["get a quote", /(get|request)\s+(a\s+)?(quote|estimate)/i],
  ["call now", /call\s+(now|today|us)/i],
  ["book", /\b(book|schedule)\b(\s+(now|online|a|an|your))?/i],
  ["contact us", /contact\s+us/i],
  ["get started", /get\s+started/i],
  ["order", /\border\s+(now|online)\b/i],
];
const ADDRESS = /\b\d{2,6}\s+[A-Za-z0-9.' ]{2,40}\s(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|pkwy|parkway|hwy|highway|pike|cir|circle)\b\.?/i;
const LOCAL_TYPES = /(LocalBusiness|HomeAndConstructionBusiness|ProfessionalService|Store|Restaurant|AutomotiveBusiness|HealthAndBeautyBusiness|MedicalBusiness|FoodEstablishment|LodgingBusiness|SportsActivityLocation|Plumber|Electrician|RoofingContractor|HVACBusiness|MovingCompany|GeneralContractor|HousePainter|Locksmith|LegalService|Dentist|AutoRepair|DryCleaningOrLaundry|EntertainmentBusiness|FinancialService|RealEstateAgent)/;

function jsonLdTypes(html: string): { types: string[]; rating: boolean } {
  const types = new Set<string>();
  let rating = false;
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = m[1]!.trim();
    if (/aggregateRating/i.test(raw)) rating = true;
    try {
      const walk = (v: unknown): void => {
        if (Array.isArray(v)) return v.forEach(walk);
        if (v && typeof v === "object") {
          const t = (v as Record<string, unknown>)["@type"];
          if (typeof t === "string") types.add(t);
          if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && types.add(x));
          Object.values(v as Record<string, unknown>).forEach(walk);
        }
      };
      walk(JSON.parse(raw));
    } catch {
      for (const t of raw.matchAll(/"@type"\s*:\s*"([^"]+)"/g)) types.add(t[1]!);
    }
  }
  return { types: [...types], rating };
}

export function detectPlatform(html: string): string | null {
  const gen = html.match(/<meta[^>]+name\s*=\s*["']generator["'][^>]*content\s*=\s*["']([^"']+)/i)?.[1]?.toLowerCase() ?? "";
  const h = html.slice(0, 200_000);
  if (gen.includes("wix") || /static\.wixstatic\.com|wix\.com\/|_wixCIDX/i.test(h)) return "wix";
  if (gen.includes("squarespace") || /squarespace(-cdn)?\.com/i.test(h)) return "squarespace";
  if (gen.includes("wordpress") || /\/wp-content\/|\/wp-includes\//i.test(h)) return "wordpress";
  if (/img1\.wsimg\.com|godaddy/i.test(h)) return "godaddy";
  if (gen.includes("weebly") || /weebly\.com/i.test(h)) return "weebly";
  if (/cdn\.shopify\.com/i.test(h)) return "shopify";
  if (gen.includes("duda") || /dudaone|multiscreensite/i.test(h)) return "duda";
  if (/leadconnectorhq|msgsndr\.com|gohighlevel/i.test(h)) return "ghl";
  return null;
}

export function inspectHomepage(html: string, url: string): HomeSignals {
  const page = parsePage(html, url, { text: 20_000, images: 200, links: 500 });
  const { types, rating } = jsonLdTypes(html);
  const body = html.replace(/<head\b[\s\S]*?<\/head>/i, " ");
  const anchorsAndButtons = [...body.matchAll(/<(a|button)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]!.replace(/<[^>]+>/g, " "));
  const inputValues = [...body.matchAll(/<input\b[^>]*type\s*=\s*["']?submit["']?[^>]*value\s*=\s*["']([^"']+)/gi)].map((m) => m[1]!);
  const ctaText = [...anchorsAndButtons, ...inputValues].join(" | ");
  const text = page.text;
  const early = text.slice(0, Math.max(400, Math.floor(text.length * 0.15)));
  const years = [...text.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/gi)].map((m) => Number(m[1]));

  return {
    url,
    https: url.startsWith("https://"),
    viewport: /<meta[^>]+name\s*=\s*["']viewport["']/i.test(html),
    title: page.title,
    description: page.description,
    h1Count: (body.match(/<h1\b/gi) ?? []).length,
    h1: page.h1,
    canonical: Boolean(page.canonical),
    ogImage: /<meta[^>]+property\s*=\s*["']og:image["']/i.test(html),
    favicon: page.icons.length > 0,
    schemaTypes: types,
    localBusinessSchema: types.some((t) => LOCAL_TYPES.test(t)),
    ratingSchema: rating,
    telLinks: (body.match(/href\s*=\s*["']tel:/gi) ?? []).length,
    phoneInText: PHONE.test(text),
    phoneEarly: PHONE.test(early),
    forms: (body.match(/<form\b/gi) ?? []).length + (/(leadconnectorhq|msgsndr)\.com\/widget\/form|jotform|typeform|forms\.gle|hsforms|wufoo/i.test(body) ? 1 : 0),
    ctaHits: CTA_PATTERNS.filter(([, re]) => re.test(ctaText)).map(([name]) => name),
    reviewsMentioned: /\b(reviews?|testimonials?|what (our )?(customers|clients) say|★|5[- ]star|stars? on google)\b/i.test(text),
    mapEmbed: /<iframe[^>]+(google\.com\/maps|maps\.google)/i.test(body),
    addressLike: ADDRESS.test(text),
    copyrightYear: years.length ? Math.max(...years) : null,
    wordCount: page.wordCount,
    images: page.images.length,
    imagesWithAlt: page.images.filter((i) => i.alt && i.alt.trim().length > 1).length,
    platform: detectPlatform(html),
  };
}
