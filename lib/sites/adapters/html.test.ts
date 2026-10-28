import { describe, expect, it } from "vitest";
import { extractColors, extractFonts, parsePage, parseSitemap, rankColors } from "./html";

const html = `<!doctype html><html><head>
<title>Granite Oak &amp; Sons | Dumpster Rental</title>
<meta name="description" content="Same-day dumpsters in Nashville">
<meta name="theme-color" content="#1F6F3A">
<link rel="icon" href="/favicon.png"><link rel="stylesheet" href="/site.css">
<link rel="canonical" href="https://granite.example/">
<style>body{font-family:"Inter", sans-serif;color:#222} .btn{background:rgb(31,111,58)}</style>
<script>var junk = "<h1>not a heading</h1>";</script>
</head><body>
<img class="site-logo" src="/img/logo.svg" alt="Granite Oak">
<h1>Dumpsters, <em>delivered</em></h1>
<h2>Sizes</h2><h3>10 yard</h3>
<p style="color:#fff">Call us today.</p>
<a href="/about">About</a> <a href="https://other.com/x">Out</a> <a href="mailto:a@b.c">Mail</a> <a href="/about#team">Team</a>
</body></html>`;

describe("parsePage", () => {
  const p = parsePage(html, "https://granite.example/");

  it("reads title, description, h1 and headings without script content", () => {
    expect(p.title).toBe("Granite Oak & Sons | Dumpster Rental");
    expect(p.description).toBe("Same-day dumpsters in Nashville");
    expect(p.h1).toBe("Dumpsters, delivered");
    expect(p.headings).toEqual(["Sizes", "10 yard"]);
    expect(p.text.includes("not a heading")).toBe(false);
  });

  it("keeps same-origin links only, absolute and de-hashed", () => {
    expect(p.links).toEqual(["https://granite.example/about"]);
  });

  it("finds brand signals", () => {
    expect(p.logoCandidates).toEqual(["https://granite.example/img/logo.svg"]);
    expect(p.icons).toEqual(["https://granite.example/favicon.png"]);
    expect(p.themeColor).toBe("#1F6F3A");
    expect(p.canonical).toBe("https://granite.example/");
    expect(p.fonts).toEqual(["Inter"]);
    expect(p.colors).toEqual(["#222222", "#ffffff", "#1f6f3a"]);
  });
});

describe("helpers", () => {
  it("normalises colors", () => {
    expect(extractColors("a{color:#ABC;background:rgba(255, 0, 10, .5)}")).toEqual(["#aabbcc", "#ff000a"]);
  });

  it("reads Google Fonts families", () => {
    expect(extractFonts("https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&display=swap")).toEqual([
      "Playfair Display",
    ]);
  });

  it("ranks colors by frequency", () => {
    expect(rankColors(["#111111", "#222222", "#111111"], 1)).toEqual([{ value: "#111111", count: 2 }]);
  });

  it("separates sitemap indexes from url sets", () => {
    expect(parseSitemap("<urlset><url><loc>https://a.com/</loc></url></urlset>")).toEqual({ urls: ["https://a.com/"], sitemaps: [] });
    expect(parseSitemap("<sitemapindex><sitemap><loc>https://a.com/s1.xml</loc></sitemap></sitemapindex>")).toEqual({
      urls: [],
      sitemaps: ["https://a.com/s1.xml"],
    });
  });
});
