// Dependency-free HTML extraction for the fetch crawler. Regex-based on
// purpose: intake needs an inventory and brand signals, not a DOM. Pure — no
// imports — so it is unit-tested directly (html.test.ts).

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

const clean = (s: string) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? "") : null;
}

function metaContent(html: string, key: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const n = (attr(tag, "name") ?? attr(tag, "property") ?? "").toLowerCase();
    if (n === key) return attr(tag, "content");
  }
  return null;
}

export type ParsedPage = {
  title: string | null;
  description: string | null;
  h1: string | null;
  headings: string[];
  text: string;
  wordCount: number;
  images: { src: string; alt: string | null }[];
  links: string[];
  canonical: string | null;
  themeColor: string | null;
  icons: string[];
  logoCandidates: string[];
  colors: string[];
  fonts: string[];
  stylesheets: string[];
};

export function parsePage(html: string, pageUrl: string, caps = { text: 6000, images: 40, links: 200 }): ParsedPage {
  const origin = new URL(pageUrl).origin;
  const abs = (href: string | null) => {
    if (!href) return null;
    try {
      const u = new URL(href, pageUrl);
      u.hash = "";
      return u.toString();
    } catch {
      return null;
    }
  };

  const body = html.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ");
  const styleBlocks = (body.match(/<style\b[\s\S]*?<\/style>/gi) ?? []).join("\n");
  const visible = body.replace(/<style\b[\s\S]*?<\/style>/gi, " ");

  const title = (() => {
    const m = visible.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    return m ? clean(m[1]!) || null : null;
  })();
  const h1m = visible.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const headings = [...visible.matchAll(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/gi)].map((m) => clean(m[1]!)).filter(Boolean).slice(0, 40);

  const mainText = clean(visible.replace(/<head\b[\s\S]*?<\/head>/i, " "));
  const words = mainText ? mainText.split(" ").length : 0;

  const images: ParsedPage["images"] = [];
  const logoCandidates: string[] = [];
  for (const tag of visible.match(/<img\b[^>]*>/gi) ?? []) {
    const src = abs(attr(tag, "src") ?? attr(tag, "data-src"));
    if (!src) continue;
    const alt = attr(tag, "alt");
    if (images.length < caps.images) images.push({ src, alt });
    if (/logo/i.test(`${src} ${alt ?? ""} ${attr(tag, "class") ?? ""} ${attr(tag, "id") ?? ""}`)) logoCandidates.push(src);
  }

  const links = new Set<string>();
  for (const tag of visible.match(/<a\b[^>]*>/gi) ?? []) {
    const href = attr(tag, "href");
    if (!href || /^(mailto|tel|javascript):/i.test(href)) continue;
    const u = abs(href);
    if (u && u.startsWith(origin) && links.size < caps.links) links.add(u);
  }

  const icons: string[] = [];
  const stylesheets: string[] = [];
  let canonical: string | null = null;
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (attr(tag, "rel") ?? "").toLowerCase();
    const href = abs(attr(tag, "href"));
    if (!href) continue;
    if (rel.includes("icon")) icons.push(href);
    if (rel.includes("stylesheet")) stylesheets.push(href);
    if (rel === "canonical") canonical = href;
  }

  const css = `${styleBlocks}\n${(visible.match(/style\s*=\s*"[^"]*"/gi) ?? []).join("\n")}`;
  return {
    title,
    description: metaContent(html, "description") ?? metaContent(html, "og:description"),
    h1: h1m ? clean(h1m[1]!) || null : null,
    headings,
    text: mainText.slice(0, caps.text),
    wordCount: words,
    images,
    links: [...links],
    canonical,
    themeColor: metaContent(html, "theme-color"),
    icons,
    logoCandidates,
    colors: extractColors(css),
    fonts: extractFonts(`${css}\n${html.match(/fonts\.googleapis\.com\/css2?\?[^"'\s>]+/gi)?.join("\n") ?? ""}`),
    stylesheets,
  };
}

/** Hex colors (3/6 digit) and rgb() normalised to lowercase 6-digit hex. Greys/white/black included — the proposer decides. */
export function extractColors(css: string): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    const h = m[1]!.toLowerCase();
    out.push(`#${h.length === 3 ? h.split("").map((c) => c + c).join("") : h}`);
  }
  for (const m of css.matchAll(/rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/gi)) {
    out.push(`#${[m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0")).join("")}`);
  }
  return out;
}

const GENERIC_FONTS = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "inherit", "initial", "-apple-system", "blinkmacsystemfont", "ui-sans-serif", "ui-serif", "ui-monospace"]);

export function extractFonts(css: string): string[] {
  const out = new Set<string>();
  for (const m of css.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
    const first = m[1]!.split(",")[0]!.trim().replace(/^['"]+|['"]+$/g, "").trim();
    if (first && !GENERIC_FONTS.has(first.toLowerCase()) && !first.startsWith("var(")) out.add(first);
  }
  for (const m of css.matchAll(/family=([^&:"'\s]+)/gi)) {
    for (const fam of decodeURIComponent(m[1]!).split("|")) out.add(fam.replace(/\+/g, " ").split(":")[0]!);
  }
  return [...out].slice(0, 10);
}

/** Frequency-ranked palette, top n. */
export function rankColors(all: string[], n = 12): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const c of all) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([value, count]) => ({ value, count }));
}

/** <loc> entries from a sitemap (or sitemap index). */
export function parseSitemap(xml: string): { urls: string[]; sitemaps: string[] } {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decode(m[1]!));
  return /<sitemapindex\b/i.test(xml) ? { urls: [], sitemaps: locs } : { urls: locs, sitemaps: [] };
}
