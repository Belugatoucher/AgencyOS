# STATUS — through Week 7: Scheduler

_Last session: 2026-07-17. Read this first next session (HANDOFF.md rule)._

## Week 7 — Scheduler (docs/06) — COMPLETE (manual-first; GHL adapter deferred)
Plan, draft, approve, and publish social content per client from one calendar.

- **Calendar** — month grid per-account and an all-accounts master view; posts colored by status; ghost cards render each content slot's owed occurrences that have no post that day.
- **Composer** — channel multi-select, default body + per-channel overrides, media picker from the account's asset library (records `asset_usage`), scheduled time, approval toggle, live per-channel validation issues (IG/TikTok media-required, caption limits, body caps — checked at draft, not publish).
- **Approval** — `approval_required` gates the `scheduled` transition (hard stop, no approval → no publish); approvers are internal or a client member of the account (the portal reuses the same route).
- **Publish** — pluggable adapter: **manual-first default** marks a due post published (team posts by hand, calendar is the plan-of-record); `PUBLISH_MODE=ghl` + GHL creds swap in the GHL Social Planner adapter (deferred, the single rewrite point). A `cron` `publish-sweep` (every 2 min) enqueues `publish-post` jobs for due posts; failures flip to `failed` and page Slack.
- **AI drafting** — "Draft with AI" runs `prompts/content-repurpose.md` verbatim against a source (transcript/blog/bullets), Zod-gated, pre-fills per-channel overrides; a human always reviews.
- **Content slots** — recurring RRULE slots per account drive the ghost cards.

Routes: `GET/POST /api/posts`, `GET/PATCH /api/posts/:id`, `POST /api/posts/:id/approval`, `POST /api/posts/:id/ai-draft`, `GET/POST /api/content-slots`, `GET /api/content-slots/ghosts`. Nav: Calendar tab.

## Verified this session (real Postgres + Redis)
- Unit: **46 pass** (+6 channel validation). E2e: **8 pass** (+scheduler composer). Route-matrix: **164/164** (+20 post/slot cases: account-scoped, client of A 404 cross-account / 403 create, anon 401).
- Full flow by curl: IG-no-media flagged; scheduling blocked while issues exist; approval gate (request → approve → schedule); ghost cards (6 TU/TH occurrences over 3 weeks). **Publish proven end-to-end:** the sweep found the due `scheduled` post and the manual adapter marked it `published` (job_runs ok) — no GHL needed in manual mode.
- AI drafting wiring is identical to lead-scoring/notes (fails loudly without `ANTHROPIC_API_KEY`).

## How to run (unchanged, plus)
```bash
pnpm test          # 46 unit
pnpm test:matrix   # 164-check route matrix (needs running app + DB)
pnpm build && pnpm test:e2e   # 8 playwright specs
pnpm worker        # media, transcribe, ai (score-lead, meeting-notes), publish (publish-post), cron (…, publish-sweep)
```
Publishing works today in manual mode. Set `PUBLISH_MODE=ghl` + `GHL_*` creds once GHL exists (adapter stub is in `lib/scheduler/publish.ts`).

## Next (Weeks 8-9 — Intelligence + Metrics, docs/08 + docs/09)
This introduces the RAG rail. Intelligence needs **pgvector + an embedding worker** (new infra — add the pgvector extension + a `media`-style embed job), the hooks DB (PWA share-target capture), a research pipeline, the per-client **Brain** (RAG with **read-only tools only** — audit item 8), and Ask-the-Brain chat with retrieval + citations (scope walls: client Brain ↔ handbook, cross-client anonymization). Metrics (docs/09): CSV importer + rollups + `is_winning` compute feeding Intelligence. Tables are in `db/002-intelligence.sql`. The `ai` queue, the Zod-gated extraction pattern, and the manual-first adapter posture are the templates.

## Carrying forward / needs Ryan
- **AI features need `ANTHROPIC_API_KEY`**: lead scoring, meeting notes, content drafting. Transcription needs whisper/pyannote (worker image) + `HF_TOKEN`. Publishing needs GHL only when you leave manual mode.
- Media + transcription verified for wiring only in this env (no full ffmpeg/whisper, no real R2). First deploy: transcode a clip, transcribe a clip, publish a post.
- Scheduler week view + GHL publish adapter are the remaining Scheduler post-MVP items.
- Portal (doc 11, wk10) exposes client-facing views; `client_visible` honored server-side across all modules; post approval already accepts a client member.
- Route-matrix hand-extended per new route (automation still TODO). Now 164 checks.
- Standing deploy needs: SMTP_URL, R2 creds + CORS, AUTH_SECRET, APP_ENCRYPTION_KEY, ANTHROPIC_API_KEY, HF_TOKEN; GHL_* when leaving manual publish.
