# 18 — Sites (Agentic Website Builder)

## Purpose

One place to take a client's website from "here's the old URL" to a live, monitored, agent-maintained site:

1. **Intake** — crawl the old site: page inventory, copy, images, meta, brand (colors, fonts, logo), baseline audit.
2. **Design system** — the agent proposes tokens, components and a sitemap from the snapshot. **Approval gate.**
3. **Build** — an agent run (Claude Code / Agent SDK driven by a *skill pack*) writes the site as code into the client's repo and produces a preview deploy. **Approval gate.**
4. **Deploy** — approved builds promote to production; every deploy is recorded and can be rolled back.
5. **Operate** — health probes (uptime, SSL, domain, Core Web Vitals, broken links, forms) and analytics (Search Console, GA4, GHL leads) feed a per-site dashboard. A weekly optimization run proposes changes that wait in the same approval queue.

Supersedes the VNGRD Studio prompt-to-page builder: Studio's v2 scope (Cloudflare Pages + analytics) is folded in here.

## Reuse map

- Spine: every site belongs to an **account** (and optionally a project). No parallel client list.
- Jobs: a new `sites` queue on the existing BullMQ rails; every run lands in `job_runs` and `/admin/health`.
- Notifications: approvals waiting, failed deploys and health failures go through `notify()` (bell + Slack mirror).
- Brain/brand: intake writes extracted brand into the design-system draft; `accounts.brand` stays the account-level record (doc 14).
- GHL: sites post forms to GHL via External Tracking, so leads land in the existing Leads pipeline. GHL-hosted funnels stay for hand-built ad landing pages.

## Pluggable parts (the framework)

Everything that talks to the outside world sits behind an interface in `lib/sites/types.ts`, chosen per site or per environment in `lib/sites/registry.ts`. This is what lets us swap our own skills, Searchmaxxed's, or a different host without touching services.

| Interface | Job | Ships with | Later |
|---|---|---|---|
| `Crawler` | old site → `SiteSnapshot` | `fetch` crawler (sitemap + same-origin links, capped) | Playwright crawler for JS-rendered sites, screenshots |
| `DesignProposer` | snapshot + brief → `DesignSystemDraft` | Claude, `prompts/sites-design-system.md` | visual board render |
| `BuildRunner` | approved design + brief → code on a branch + preview | `manual` (a person runs the agent, then reports back) | `claude-code` container runner, Agent SDK |
| `RepoProvider` | repos, branches, PRs | `none` | GitHub |
| `HostProvider` | projects, deploys, promote, rollback, domains | `manual` | Cloudflare Pages, Vercel |
| `HealthProbe` | one check → `ok/warn/fail` | uptime, SSL expiry (both real) | Lighthouse/PSI, broken links, form delivery, domain expiry |
| `AnalyticsSource` | daily rows per site | none | Search Console, GA4, GHL |

### Skill packs

A **skill pack** is a versioned folder of agent instructions the `BuildRunner` loads for a phase (`build`, `optimize`, `audit`). Packs live in `skills/sites/<pack-id>/` with a `pack.json` manifest; the registry reads them. Each site picks a pack (default `vngrd-default`). Runs record the pack id + version so a result can always be traced to the instructions that produced it.

- `vngrd-default` — our own pack, skeleton today.
- `searchmaxxed` — listed but **disabled** until we confirm their course licence allows use inside a multi-client tool. If it doesn't, we keep the approach and write our own skills.

## Model

```
sites               — account_id, project_id?, name, slug, stage, status, domain,
                      production_url, preview_url, source_url,
                      host (manual|cloudflare_pages|vercel|ghl|external), host_ref,
                      repo (manual|github), repo_ref, skill_pack, settings jsonb, deleted_at
site_snapshots      — site_id, source_url, status, pages jsonb, brand jsonb, audit jsonb,
                      page_count, error, created_by, created_at, finished_at
site_design_systems — site_id, snapshot_id?, version, status (drafting|proposed|approved|rejected|superseded|failed),
                      brief, tokens jsonb, components jsonb, sitemap jsonb, rationale,
                      decided_by, decided_at, decision_note
site_builds         — site_id, design_system_id?, kind (initial|change|optimize), status
                      (queued|running|awaiting_review|approved|rejected|failed|cancelled),
                      brief, runner, skill_pack, skill_pack_version, branch, commit_sha,
                      preview_url, summary, changes jsonb, log jsonb, run_ref,
                      requested_by, decided_by, decided_at, started_at, finished_at
site_deploys        — site_id, build_id?, environment (preview|production), status
                      (queued|building|ready|failed|rolled_back), provider_ref, url, commit_sha,
                      created_by, created_at, finished_at
site_checks         — site_id, kind, status (ok|warn|fail|unknown), summary, detail jsonb, checked_at
site_metrics_daily  — site_id, source (gsc|ga4|ghl), date, metrics jsonb   (unique site+source+date)
integration_credentials — scope (org|account), account_id?, provider, label,
                          secret_enc (AES-256-GCM), meta jsonb   (audit item 2)
```

### Stages

`intake → design → build → review → live`, plus `paused` and `archived`. Stage moves are computed by `lib/sites/pipeline.ts` (pure, tested): a stage only advances when its gate is met — an approved design system for `design → build`, an approved build with a ready production deploy for `review → live`. The same module derives the dashboard's **next action** for each site ("Approve design v2", "Review build #14", "Fix: SSL expires in 6 days").

## Access

Internal only (admin/member) for now — clients never see agent runs, drafts or credentials. Credentials are admin-only to create and are never returned by any route (only provider + label + last 4). A client-facing "Your website" card in the portal is a later item.

## Jobs (`sites` queue)

| Job | Trigger |
|---|---|
| `site-crawl` | intake started |
| `site-propose-design` | crawl finished (auto) or "Propose again" |
| `site-build` | build requested (after design approval, or a change/optimize request) |
| `site-deploy` | build approved → production; or preview |
| `site-health` | per site, from the sweep or "Run checks now" |
| cron `sites-health-sweep` | every 15 min — enqueues `site-health` for every live site |
| cron `sites-analytics-pull` | nightly 03:15 — each configured source pulls yesterday |
| cron `sites-optimize-weekly` | Mon 07:30 — queues an `optimize` build for live sites that opted in |

Deploy-provider webhooks land at `/api/sites/hooks/[provider]`: verify → enqueue → 200 in <1s; **501 when unconfigured** (same posture as Stripe/Slack).

## Grader (lead magnet + prospecting)

The front of the funnel for the website + SEO offer (`docs/offers/web-seo.md`). It grades any site the way a customer and Google see it, and turns the result into a lead or a pitch.

- **Checks** (`lib/grader/*`, pure + tested): homepage inspection (tap-to-call, phone up top, quote form, CTA, reviews, schema, NAP, freshness, platform), a 15-page crawl (pages, missing meta, thin pages, broken links), Google PageSpeed (mobile; `PAGESPEED_API_KEY`), SSL, and an optional **Google Maps grid**: 5×5 points, 1 mile apart, around the business via DataForSEO (`DATAFORSEO_*`). It finds the business at each point and names the competitor that holds #1 most.
- **Score:** six sections (speed, mobile, search basics, trust, getting the call, Google Maps), weighted to 0–100 with a letter grade and the top 5 fixes ordered by what costs calls. It's deterministic, so re-grading after fixes shows real movement.
- **Public:** `/grade` (form) → `POST /api/grader` → job → `/grade/<token>` report with the offer. Each run creates a lead in `GRADER_PIPELINE_ID` and posts to the GHL inbound webhook (`GRADER_GHL_WEBHOOK_URL`) for follow-up. Without GHL, the report is emailed directly. Controls: per-IP limit, daily spend cap, honeypot, Zod caps, SSRF-guarded fetches, 192-bit expiring tokens, contact details never on the report.
- **Internal:** `/sites/grader` grades one prospect or a list (up to 100, spaced out), shows who **opened** their report, and copies a ready pitch.

## Build checklist

- [x] Spec, schema (db/010), Drizzle tables
- [x] Pipeline stage machine + next-action derivation (pure, unit tested)
- [x] Adapter interfaces + registry; manual host/runner; fetch crawler; uptime + SSL probes
- [x] Skill-pack manifest format + registry + `vngrd-default` skeleton
- [x] Credential encryption helper (AES-256-GCM, `APP_ENCRYPTION_KEY`)
- [x] Services: sites CRUD/overview, intake, design proposals + decisions, builds + decisions, deploys + rollback, health, analytics read
- [x] `sites` queue, processors, three crons
- [x] API routes (internal-only guard in services)
- [x] `/sites` dashboard + `/sites/[id]` detail (Overview · Intake · Design · Builds · Deploys · Health · Analytics · Settings)
- [ ] Drizzle migration generated (`pnpm db:generate`) and applied
- [ ] Route-matrix: 14 Sites cases written in `tests/route-matrix.ts` — not yet run against a live server
- [ ] Credentials UI (admin) + routes
- [ ] `claude-code` BuildRunner: containerised Claude Code / Agent SDK run against the site repo, streaming log into `site_builds.log`
- [ ] GitHub RepoProvider (repo from template, branch per build, PR, merge on approval)
- [ ] Cloudflare Pages HostProvider (+ deploy webhook verify) — then Vercel if needed
- [ ] Probes: PageSpeed Insights (CWV), broken links via crawler, form delivery (test submission → GHL contact lookup), domain expiry (RDAP)
- [ ] Analytics: Search Console + GA4 (OAuth, encrypted tokens), GHL leads per site
- [ ] Design board: render the proposed tokens/components as a visual page
- [ ] `vngrd-default` skill pack content (build / optimize / audit)
- [ ] Searchmaxxed pack — only after licence check
- [x] Grader: engine, public page + report, internal console, lead + GHL handoff (db/012)
- [ ] Grader: prospect preview site (one-page build from the Google listing), shown on the report
- [ ] Grader: monthly re-grade + Maps grid trend per client (the client report)
- [ ] Grader: AI-answer visibility check
- [ ] Portal "Your website" card (uptime, leads, last update) — client-visible subset
- [ ] Playwright smoke: create site → intake → approve design → manual build → approve → live
