# STATUS — through Week 3: Leads

_Last session: 2026-07-17. Read this first next session (HANDOFF.md rule)._

## Week 3 — Leads (manual-first, docs/02) — COMPLETE (roadmap scope)

Roadmap Week 3 scope shipped; the two explicitly-deferred items (portal leads page → Week 10, GHL connector → when GHL exists) are left unchecked in docs/02 with reasons.

- **Pipelines/stages** — CRUD, default stages seeded per pipeline (New → Contacted → Qualified → Proposal → Won / Lost); stage delete blocked while it holds leads. Pipelines always belong to an account (per db/006).
- **Leads** — CRUD, inline editing, drag kanban + table toggle, drawer with timeline (notes + stage changes), owner/next-action/value/notes inline edits. Filters: pipeline/account/stage/owner + `no_next_action` shame list.
- **CSV import** — dependency-free parser (7 unit tests), 5MB/5000-row caps, per-pipeline.
- **Public intake endpoint** (`POST /api/intake/[token]`) — unauthenticated lead capture with audit-item-6 hardening: ≥128-bit tokens, per-IP rate limit (20/15min), honeypot (passes schema, drops silently at the service, 200 either way), strict Zod, 16KB body cap, identical responses for unknown tokens.
- **All-accounts overview** — per-pipeline totals, open value, won-this-month, no-next-action counts; metrics strip.
- **AI scoring** — `ai` queue job `score-lead`. Prompt loaded verbatim from `prompts/lead-scoring.md`; output Zod-validated with one retry then fails loudly; writes score + rationale and appends the JSON as a note activity. Human gates intact (never moves a stage). Model configurable via `LEAD_SCORING_MODEL` (default `claude-sonnet-5`).

Routes: `GET/POST /api/pipelines`, `GET /api/pipelines/:id`, `POST /api/pipelines/:id/stages`, `DELETE …/stages/:id`, `POST …/intake`, `POST …/import`, `GET/POST /api/leads`, `GET/PATCH /api/leads/:id`, `POST /api/leads/:id/{move,notes,score}`, `GET /api/leads/overview`, `POST /api/intake/:token` (public). Nav: internal users get a Leads tab.

## Verified this session (real Postgres + Redis)
- Unit: **33 pass** (access 12, rrule 9, lead-scoring schema 5, lead-intake/CSV 7). E2e: **4 pass** (week-1, magic-link single-use, tasks, leads). Route-matrix: **84/84** (added 7 lead/pipeline cases × 4 roles proving client isolation).
- Drove the full leads path via curl: pipeline create (6 stages seeded) → lead create/move/note → intake (valid 200, honeypot 200-dropped, bad-token 404) → CSV import (2 imported, blank row skipped) → overview totals.
- AI scoring wiring verified end-to-end: enqueue → 202, worker runs, 3 BullMQ retries, fails loudly with a clear `job_runs` error (no ANTHROPIC_API_KEY in this env). Real scores need the key set.

## How to run (unchanged, plus)
```bash
pnpm test          # vitest: access, rrule, lead-scoring, lead-intake
pnpm test:matrix   # 84-check route matrix (needs running app + DB)
pnpm build && pnpm test:e2e   # 4 playwright specs (CHROMIUM_PATH=/opt/pw-browsers/chromium here)
pnpm worker        # cron (recurring/digest) + ai (heartbeat, score-lead)
```
Set `ANTHROPIC_API_KEY` (+ optional `LEAD_SCORING_MODEL`, `AGENCY_SERVICES_BLURB`) to get real lead scores. Local infra: Postgres/Redis are reclaimed between idle periods in this container — restart with `pg_ctl … start` / `redis-server --daemonize yes` (scratchpad env.sh).

## Next (Week 4 — Assets, docs/05)
- Asset grid, collections, Brand Kit, share links + PIN, thumbnails — this builds the **media worker** Review (Week 5) needs. The file service (Week 1) and the `media` queue rail already exist; Assets adds ffmpeg thumbnailing to the worker and the assets/collections tables.
- Share links reuse the `share_links` table (already in db/schema.sql) with audit-item-1 hardening (short-lived signed R2 URLs, PIN rate limiting) — first real use of that table.

## Carrying forward / needs Ryan
- GHL connector (doc 02 appendix) deferred until GHL exists; `lead_mode`, `sync_map`, `sync_log` columns are ready.
- Portal leads page deferred to Week 10 (doc 11); `portal_leads` / `client_hidden` columns respected in writes but no client read path yet.
- Route-matrix still extended by hand per new route (automation still TODO).
- Real env for deploy: SMTP_URL, R2 creds + bucket CORS, AUTH_SECRET, APP_ENCRYPTION_KEY, ANTHROPIC_API_KEY. Turnstile keys present in .env.example but not yet wired to the intake form (honeypot + rate limit cover it for now).
