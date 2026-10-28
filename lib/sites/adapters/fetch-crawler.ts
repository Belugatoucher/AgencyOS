import type { CrawledPage, Crawler, CrawlOptions, IntakeAudit, SiteSnapshotResult } from "@/lib/sites/types";
import { parsePage, parseSitemap, rankColors } from "./html";
import { safeFetch } from "./safe-fetch";

// Default Crawler (docs/18): sitemap.xml seeds + same-origin link discovery,
// breadth-first, capped. Server-rendered HTML only — JS-heavy sites (Wix,
// some Squarespace templates) come back thin; the Playwright crawler slot in
// the registry is where that gets fixed. Inline <style> and style="" only for
// brand colors; external stylesheets are fetched for the homepage (capped).

const SKIP_EXT = /\.(pdf|jpe?g|png|gif|webp|svg|ico|zip|mp4|mov|mp3|docx?|xlsx?|pptx?|css|js|json|xml|txt)(\?|$)/i;
const CONCURRENCY = 4;
const MAX_STYLESHEETS = 4;

function canonicalKey(url: string): string {
  const u = new URL(url);
  u.hash = "";
  u.search = "";
  return `${u.origin}${u.pathname.replace(/\/+$/, "") || "/"}`;
}

export const fetchCrawler: Crawler = {
  id: "fetch",
  async crawl(sourceUrl: string, opts: CrawlOptions): Promise<SiteSnapshotResult> {
    const root = await safeFetch(sourceUrl, { timeoutMs: opts.timeoutMs });
    const origin = new URL(root.url).origin; // follow www/https redirects once, then stay on that origin

    const queue: { url: string; from: string }[] = [];
    const seen = new Set<string>();
    const enqueue = (url: string, from: string) => {
      if (!url.startsWith(origin) || SKIP_EXT.test(url)) return;
      const key = canonicalKey(url);
      if (seen.has(key)) return;
      seen.add(key);
      queue.push({ url: key, from });
    };

    // seeds: sitemap first (finds orphan pages), then homepage links
    try {
      const sm = await safeFetch(`${origin}/sitemap.xml`, { timeoutMs: opts.timeoutMs, maxBytes: 3_000_000 });
      if (sm.status === 200) {
        let { urls, sitemaps } = parseSitemap(sm.body);
        for (const child of sitemaps.slice(0, 3)) {
          const c = await safeFetch(child, { timeoutMs: opts.timeoutMs, maxBytes: 3_000_000 }).catch(() => null);
          if (c?.status === 200) urls = urls.concat(parseSitemap(c.body).urls);
        }
        for (const u of urls.slice(0, opts.maxPages * 3)) enqueue(u, "sitemap");
      }
    } catch {
      /* no sitemap is normal */
    }

    const pages: CrawledPage[] = [];
    const allColors: string[] = [];
    const fonts = new Set<string>();
    const logos: string[] = [];
    let favicon: string | null = null;
    let themeColor: string | null = null;
    const brokenLinks: IntakeAudit["brokenLinks"] = [];

    const record = (url: string, status: number, html: string, from: string) => {
      if (status >= 400) {
        brokenLinks.push({ url, status, from });
        return;
      }
      const p = parsePage(html, url);
      pages.push({
        url,
        status,
        title: p.title,
        description: p.description,
        h1: p.h1,
        headings: p.headings,
        wordCount: p.wordCount,
        text: p.text,
        images: p.images,
        links: p.links,
        canonical: p.canonical,
      });
      allColors.push(...p.colors);
      p.fonts.forEach((f) => fonts.add(f));
      logos.push(...p.logoCandidates);
      favicon ??= p.icons[0] ?? null;
      themeColor ??= p.themeColor;
      for (const l of p.links) enqueue(l, url);
      return p;
    };

    seen.add(canonicalKey(root.url));
    const home = record(canonicalKey(root.url), root.status, root.body, "start");

    // homepage stylesheets carry most of the palette and type
    for (const href of home?.stylesheets.filter((s) => s.startsWith(origin)).slice(0, MAX_STYLESHEETS) ?? []) {
      const css = await safeFetch(href, { timeoutMs: opts.timeoutMs, maxBytes: 1_000_000 }).catch(() => null);
      if (css?.status === 200) {
        const parsed = parsePage(`<style>${css.body}</style>`, root.url);
        allColors.push(...parsed.colors);
        parsed.fonts.forEach((f) => fonts.add(f));
      }
    }

    while (queue.length > 0 && pages.length < opts.maxPages) {
      const batch = queue.splice(0, Math.min(CONCURRENCY, opts.maxPages - pages.length));
      await Promise.all(
        batch.map(async ({ url, from }) => {
          try {
            const res = await safeFetch(url, { timeoutMs: opts.timeoutMs });
            const type = res.headers.get("content-type") ?? "";
            if (res.status < 400 && !type.includes("html")) return;
            record(url, res.status, res.body, from);
          } catch (e) {
            brokenLinks.push({ url, status: 0, from: `${from} (${e instanceof Error ? e.message : "error"})` });
          }
        }),
      );
    }

    const audit: IntakeAudit = {
      brokenLinks: brokenLinks.slice(0, 100),
      missingMeta: pages
        .map((p) => ({
          url: p.url,
          missing: [!p.title && "title", !p.description && "description", !p.h1 && "h1"].filter(Boolean) as ("title" | "description" | "h1")[],
        }))
        .filter((m) => m.missing.length > 0),
      thinPages: pages.filter((p) => p.wordCount < 150).map((p) => ({ url: p.url, wordCount: p.wordCount })),
      notes: [],
    };
    if (queue.length > 0) audit.notes.push(`Stopped at ${opts.maxPages} pages; ${queue.length} more were discovered.`);
    if (pages.length > 0 && pages.every((p) => p.wordCount < 50))
      audit.notes.push("Pages came back nearly empty — the site likely renders with JavaScript. Use the browser crawler when it lands.");

    return {
      pages,
      brand: {
        colors: rankColors(allColors),
        fonts: [...fonts],
        logoUrl: logos[0] ?? null,
        faviconUrl: favicon ?? `${origin}/favicon.ico`,
        themeColor,
      },
      audit,
    };
  },
};
