# STATUS — through Weeks 8-9: Intelligence + Metrics

_Last session: 2026-07-17. Read this first next session (HANDOFF.md rule)._

## Weeks 8-9 — Intelligence (docs/08) + Metrics (docs/09) — COMPLETE (MVP scope; see checklists)
The RAG rail is live: pgvector + embeddings + retrieval, the per-client Brain, and the metrics pipeline that feeds winning-creative computation.

- **Embeddings** — `lib/embeddings`: pluggable via `EMBED_MODE` — `hash` default (deterministic 384-dim, cosine ≈ lexical overlap, so retrieval ordering is real and testable in dev/CI); `local` runs bge-small via `scripts/embed.py` (installed in the worker image). Migration 0006 creates the `vector` extension + hnsw cosine indexes; compose now uses `pgvector/pgvector:pg16`.
- **Hooks** — global + per-account library; create embeds inline, CSV import (`text,format,platform,niche_tags,source_url`), search = filters + semantic ranking via pgvector `<=>`. PWA share-target lands with the PWA shell (doc 13).
- **Research** — paste → doc row → `embed-research` ai job chunks (1200/150 overlap) + embeds → `research_chunks`; status processing→ready|failed. Semantic search over chunks scoped to this-account + global.
- **Creatives** — performance log; a written learning auto-proposes a Brain suggestion; nightly rollup writes period totals + rates into `creatives.metrics` and recomputes `is_winning` (top quartile = best ceil(n/4) on the primary KPI, min-spend floor $100 default).
- **Client Brain** — editor (offer/ICP/positioning/voice/objections/proof points/compliance no-gos/goals); every write snapshots to `brain_versions` and bumps `version`. Suggestion queue: creatives' learnings + meeting decisions (applyNotes bridge) propose; humans accept/reject; the Brain never self-edits.
- **Ask the Brain** — tool loop (audit item 8): four read-only Zod-gated tools (search_hooks/search_research/search_creatives/get_brain) under the viewer's access scope; retrieval scope is structurally this-account + global (cross-client rows never fetched); every thread stores messages + retrieval IDs in `ai_threads`. `/brief` reuses the loop. Non-streaming v1; prompt from `prompts/client-brain.md` verbatim; `BRAIN_CHAT_MODEL` (default current Sonnet).
- **Metrics** — `db/007-metrics.sql` (new; pack had no SQL for docs/09): `metric_sources` (saved column mappings) + `metric_rows` with `unique(source_id, external_id, date)` → idempotent CSV re-imports. Ad↔creative matching by id-slug in ad name (full uuid or ≥8-hex prefix), manual link route for stragglers, `unmatched-spend-digest` cron (Mon 09:00) pages unmatched spend. `metrics-rollup` cron (02:30 nightly).

Routes: `GET/POST /api/hooks` (+`/import`), `GET/POST /api/research` (+`/search`), `GET/POST /api/creatives`, `GET/PATCH /api/brain/:accountId` (+`/suggestions`, `/chat`, `/brief`), `POST /api/brain/suggestions/:id`, `GET/POST /api/metrics/sources` (+`/:id/import`), `GET /api/metrics/unmatched`, `POST /api/metrics/rows/:id/link`. Nav: Intelligence tab (internal only — the whole layer is invisible to clients).

## Verified this session (real Postgres + pgvector + Redis)
- Unit: **60 pass** (+14: embedder determinism/ranking/chunking, slug matching, aggregation, quartile winners). E2e: **9 pass** (+intelligence: hooks add/semantic search, research paste, creative log → Brain suggestion → accept → version bump). Route-matrix: **228/228** (+64: all Intelligence/Metrics routes — internal-only 403 for clients, anon 401, suggestion decide-once 409).
- `scripts/verify-intelligence.ts` (23 checks, all pass, run against the live worker): research doc embedded by the real `embed-research` job → chunks with 384-dim embeddings → **pgvector retrieval ranks the right chunk first**; hooks semantic ordering; creative learning → suggestion → accept applies learning + versions the Brain; meeting-decision bridge; CSV import matched the slug-named ad, re-import stayed idempotent (3 rows, no dupes), rollup computed spend 200.50 / ROAS 3.09 and flagged the winner.
- Brain chat wiring fails loudly without `ANTHROPIC_API_KEY` (same posture as scoring/notes); auth ordering proven by matrix (clients 403 before any model call).
- Gotcha (now in decisions log): e2e must run against `pnpm build && pnpm start` — the audit CSP (no `unsafe-eval`) kills Next dev-mode hydration.

## How to run (unchanged, plus)
```bash
pnpm test          # 60 unit
pnpm test:matrix   # 228-check route matrix (needs running app + DB)
pnpm build && pnpm test:e2e   # 9 playwright specs
pnpm worker        # + ai: embed-research · cron: metrics-rollup, unmatched-spend-digest
pnpm tsx scripts/verify-intelligence.ts   # 23-check live pipeline verification
```
Postgres needs pgvector (compose image is `pgvector/pgvector:pg16`; bare metal: `postgresql-16-pgvector`). `EMBED_MODE=local` in prod for real embeddings (worker image has sentence-transformers).

## Next (Week 10 — Client Portal, docs/11)
The portal exposes client-facing surfaces over the rails that already enforce `client_visible` + membership scoping server-side: review approvals, post approvals, visible tasks, shared assets, and (per `org_settings`/`portal_leads`) lead summaries. The route-matrix already proves the isolation the portal relies on; portal work is mostly pages + navigation for the `client` role, which currently gets redirected to /accounts.

## Carrying forward / needs Ryan
- **AI features need `ANTHROPIC_API_KEY`**: lead scoring, meeting notes, content drafting, **Ask the Brain**. Transcription needs whisper/pyannote + `HF_TOKEN`. Publishing needs GHL only when leaving manual mode.
- Media + transcription verified for wiring only in this env (no full ffmpeg/whisper, no real R2). Embeddings/retrieval ARE verified for real (hash mode vs live pgvector); first deploy with `EMBED_MODE=local` should re-embed and spot-check retrieval quality.
- Deferred: PWA share-target (doc 13), Brain-chat streaming + send-to-composer, research file upload/extraction, metrics column-picker UI, Meta API adapter (v1.5), per-account KPI/min-spend settings.
- Route-matrix hand-extended per new route (automation still TODO). Now 228 checks.
- Standing deploy needs: SMTP_URL, R2 creds + CORS, AUTH_SECRET, APP_ENCRYPTION_KEY, ANTHROPIC_API_KEY, HF_TOKEN; GHL_* when leaving manual publish.
