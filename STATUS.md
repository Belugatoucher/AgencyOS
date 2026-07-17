# STATUS — through Week 6: Notes

_Last session: 2026-07-17. Read this first next session (HANDOFF.md rule)._

## Week 6 — Notes (docs/03) — COMPLETE
Private AI note taker: record/upload a meeting, transcribe on-box, turn it into structured notes + action items + CRM context.

- **Capture** — upload audio/video onto a meeting; `/record` in-person page (MediaRecorder, all-party-consent notice, 30s chunk backup to R2, full recording finalized on stop).
- **Pipeline** (audio never leaves our infra; only text goes to Claude): attach audio → `transcribe` job runs `scripts/transcribe.py` (faster-whisper large-v3 int8 + pyannote diarization) → writes diarized segments → `ai` `meeting-notes` job runs Claude with `prompts/meeting-notes.md` verbatim → Zod-gated JSON with one retry → owner fuzzy-match + due-date clamp → attendee→lead auto-link → write `meeting_notes`, flip status ready, notify.
- **Meeting page** — synced audio player (click a transcript line → seek), speaker rename, summary + decisions, action-items panel with checkbox → bulk-create Tasks (`source=meeting`), status polling while processing.
- **Search** — Postgres full-text across all transcripts with `ts_headline` snippets.
- **Privacy** — `client_visible` defaults false; internal-only routes; retention setting per meeting (keep/90d/transcript_only); recording-consent reminder on `/record`.

Routes: `GET/POST /api/meetings`, `GET /api/meetings/:id`, `POST/GET /api/meetings/:id/audio`, `POST /api/meetings/:id/chunks`, `PATCH …/speakers`, `POST …/reprocess`, `POST …/tasks`, `GET /api/meetings/search`. Nav: Notes tab.

## Verified this session (real Postgres + Redis)
- Unit: **40 pass** (access 12, rrule 9, lead-scoring 5, lead-intake 7, ffmpeg 3, meeting-notes 4). E2e: **7 pass** (week-1, magic-link, tasks, leads, assets, review, notes). Route-matrix: **144/144** (+20 meeting cases: Notes internal-only — client 403 on list/create/search, 404 cross-account meeting; anon 401).
- Against a seeded transcript: full-text search hit on "budget", action-items→tasks bridge (creates a task, marks `task_id`, idempotent — index 1 stays unlinked), speaker rename.
- **Pipeline proven end-to-end for wiring:** `transcribe-meeting` reaches the R2 audio fetch and `meeting-notes` reaches the Claude call, both failing loudly into `job_runs`. Real transcripts/notes need the worker image's Python deps (whisper/pyannote) + `ANTHROPIC_API_KEY` + real R2. See decisions log.

## How to run (unchanged, plus)
```bash
pnpm test          # 40 unit
pnpm test:matrix   # 144-check route matrix (needs running app + DB)
pnpm build && pnpm test:e2e   # 7 playwright specs
pnpm worker        # media, transcribe (whisper), ai (score-lead, meeting-notes), cron
```
Notes transcription needs the worker Docker image (python3 + faster-whisper + pyannote; `HF_TOKEN` for diarization) + `ANTHROPIC_API_KEY` + real R2. Locally, point `R2_ENDPOINT` at MinIO and set `TRANSCRIBE_CMD` if whisper lives elsewhere.

## Next (Weeks 8-9 — Intelligence + Metrics, docs/08 + docs/09)
Week 7 (Scheduler) is the roadmap's next module, but Intelligence/Metrics may be prioritized — check the roadmap. Intelligence needs pgvector + an embedding worker (new rail), the hooks DB, research pipeline, per-client Brain (RAG with read-only tools — audit item 8), and Ask-the-Brain chat with citations. Metrics: CSV importer + rollups + is_winning compute (docs/09). The `ai` queue, RAG-scope walls, and the Zod-gated extraction pattern from Notes/Leads are the templates; `db/002-intelligence.sql` defines the tables.

## Carrying forward / needs Ryan
- **AI-dependent features need `ANTHROPIC_API_KEY`**: lead scoring, meeting notes. Transcription needs whisper/pyannote (worker image) + `HF_TOKEN`.
- Media + transcription verified for wiring only in this env (no full ffmpeg/whisper, no real R2). First deploy should transcribe a real clip end to end.
- Transcript search is computed at query time; add the stored tsvector column + GIN index at scale (SQL file already specifies it).
- Portal (doc 11, wk10) exposes client-facing views; `client_visible` honored server-side across Review/Assets/Notes.
- Route-matrix hand-extended per new route (automation still TODO). Now 144 checks.
- Standing deploy needs: SMTP_URL, R2 creds + CORS, AUTH_SECRET, APP_ENCRYPTION_KEY, ANTHROPIC_API_KEY, HF_TOKEN.
