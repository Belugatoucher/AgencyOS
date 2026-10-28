# Build phase — VNGRD default (v0.1.0, skeleton)

> Skeleton. Fill in house standards as they settle; bump pack.json version when you do.

You are building a client marketing site from an **approved design system**. Inputs (in the run context):
`designSystem` (tokens, components, sitemap, rationale), `snapshot` (old site crawl), `brief`.

## Steps

1. **Scaffold** — Astro + Tailwind, static output. Map `designSystem.tokens` to CSS variables and the Tailwind theme.
   Load fonts from Google Fonts with `display=swap`.
2. **Components** — one component per `designSystem.components[]` entry, variants as props. No component the
   design system didn't name unless the sitemap needs it; say why in the summary.
3. **Pages** — one route per `designSystem.sitemap[]` entry. Move copy from `sourceUrls` pages, tighten it,
   keep facts (service areas, prices, phone numbers) exactly as found. Never invent reviews, awards or numbers.
4. **Redirects** — 301 every old URL in the snapshot to its new path (`_redirects` / host config).
5. **SEO basics** — unique title + meta description per page, one h1, LocalBusiness JSON-LD on home and
   contact, sitemap.xml, robots.txt, canonical URLs.
6. **Forms** — plain HTML forms with name/email/phone fields; include the GHL External Tracking script so
   submissions create contacts. No third-party form services.
7. **Check** — build passes, Lighthouse mobile ≥ 90 performance / 100 SEO on home, no console errors,
   all redirects resolve.
8. **Preview** — deploy a preview (never production) and return the outcome JSON.

## TODO
- House component library and section patterns
- Copy voice guide per industry (junk removal, home services, …)
- Image handling (client photos via Agency OS assets)
