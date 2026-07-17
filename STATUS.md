# STATUS — through Weeks 11-12: Academy (SOPs · Training · Notebook)

_Last session: 2026-07-17. Read this first next session (HANDOFF.md rule)._

## Weeks 11-12 — Academy (docs/16) — COMPLETE (MVP scope; see checklist)
Replaces Trainual/Notion-wiki/NotebookLM on the existing rails: files/media workers, whisper, the wk8 RAG layer, notifications. All of it internal-only — clients never see training or the handbook.

- **SOP library** (`/sops`) — markdown SOPs in six fixed categories + tags; publish snapshots to `sop_versions` (versioned like the Brain) and **chunks-on-publish** into `kb_chunks` with GitHub-style heading anchors. **Staleness engine**: daily 06:00 cron flags published SOPs past `review_every_days` as `needs_review` + pings the owner; "Still accurate" resets the clock. **Promote to SOP** drafts from a meeting's notes or a task description.
- **Academy** (`/academy`) — courses → lessons (video|sop|doc|quiz). Video lessons ride the existing rails: `lesson-media` (HLS ladder) → `transcribe-lesson` (whisper) → `embed-lesson` (timestamped kb chunks). **Assignment rules** (roles and/or user ids) fire on invite and immediately for current holders, spawning one idempotent My-Tasks task per user+course (morning digest picks it up — no new notification machinery). **Quizzes**: Zod-gated shape, server-side grading, attempts tracked, failed questions return rewatch evidence (`evidence_ms`/`evidence_anchor`); AI lesson+quiz drafts via `prompts/course-builder.md` verbatim. Admin **completion matrix** (people × published courses).
- **Notebook** ("Ask the Handbook") — same read-only tool-loop pattern as Ask the Brain but scoped to `kb_chunks` ONLY: the **scope wall is structural both directions** (Notebook tools can't reach client tables; Brain tools never touch kb_chunks). Citations: `sop:<id>#<anchor>` and `lesson:<id>@<start_ms>`. Thin/none answers land in `notebook_gaps`; weekly Wed 09:00 cron posts the "SOPs we're missing" list to Slack; gaps resolve by pointing at the SOP that now answers them. `/handbook` via `/api/slack/commands` — v0 HMAC verified, **501 when unconfigured, never open**. `prompts/notebook.md` added following pack conventions (pack had none — see decisions).

Schema (migration 0009): `sops`, `sop_versions`, `kb_chunks` (vector 384 + hnsw), `courses`, `lessons`, `training_assignments`, `lesson_progress`, `notebook_gaps` — matches db/004-academy.sql.

Routes: `GET/POST /api/sops` (+`/[id]`, `/publish`, `/review`, `/promote`), `GET/POST /api/courses` (+`/[id]`, `/publish`), `POST /api/lessons` (+`/[id]/complete`, `/[id]/quiz`, `/draft`), `POST /api/academy/assignments`, `GET /api/academy/matrix` (admin), `GET/POST /api/notebook` (+`/gaps`, `/gaps/[id]/resolve`), `POST /api/slack/commands`. Nav: SOPs + Academy tabs.

## Verified this session (real Postgres + pgvector + Redis, prod build)
- Unit: **67 pass** (+7: heading slugs, sectionizer anchors incl. long-section re-chunk, quiz grading pass/fail/evidence, quiz-shape caps). E2e: **12 pass** (+academy: SOP author→publish, course→lesson→mark understood→publish, matrix shows the course, notebook kb search hits, gaps tab). Route-matrix: **316/316** (+40: SOPs/courses/lessons/matrix(admin-only)/notebook internal-only, Slack endpoint 501-when-unconfigured for every role).
- `scripts/verify-academy.ts` (19 checks, all pass, live worker): published SOP embedded by the real `embed-sop` job → **retrieval ranks the right section first and cites `#naming-conventions`**; quiz fail returns rewatch evidence then pass completes; matrix reads 2/2; assignment rule spawned exactly one task for a role holder and stayed idempotent on re-fire; overdue SOP flipped to `needs_review`; task promoted to draft SOP; gap listed + weekly report ran.
- Lesson video pipeline is wiring-verified (jobs registered on media/transcribe/ai queues; full ffmpeg/whisper not in this env — same posture as Review/Notes).

## How to run (unchanged, plus)
```bash
pnpm test          # 67 unit
pnpm test:matrix   # 316-check route matrix (needs running app + DB)
pnpm build && pnpm test:e2e   # 12 playwright specs
pnpm worker        # + media: lesson-media · transcribe: transcribe-lesson ·
                   #   ai: embed-sop, embed-lesson · cron: sop-staleness-sweep (06:00), notebook-gap-report (Wed 09:00)
pnpm tsx scripts/verify-academy.ts   # 19-check live pipeline verification
```

## Next (roadmap: v1.5 gates + remaining docs)
The 12-week core roadmap is BUILT. What remains is gated/deferred work, roughly by value: doc 15 Slack app (unlocks real /handbook + /brain attribution), doc 14 theming (portal theme proposal from intake logos), doc 17 presales (deck-autofill prompt exists), doc 12 v1.5 (Meta Marketing API metrics adapter, GHL adapters), doc 13 extras (PWA share-target for hooks), plus the deferral list below. Seed the six starter-curriculum tracks as real content when operating.

## Carrying forward / needs Ryan
- **AI features need `ANTHROPIC_API_KEY`**: lead scoring, meeting notes, content drafting, Ask the Brain, Notebook answers (kb *search* works without it), course-builder drafts. Transcription (meetings + lessons) needs whisper/pyannote + `HF_TOKEN`. `EMBED_MODE=local` in prod.
- Deferred this module: transcript-rail lesson player + auto-chapter render (fields + AI draft exist), SOP section diffs, team-tag assignment rules, Slack-user mapping for /handbook (doc 15), starter curriculum content.
- Prior deferrals stand: intake drop-box (public presign), portal theme proposal (doc 14), portal Documents/Leads pages, composer suggestion accept/decline UI, review v2 diffs, custom domains, Meta metrics adapter (v1.5).
- Route-matrix hand-extended per new route (automation still TODO). Now 316 checks.
- Standing deploy needs: SMTP_URL, R2 creds + CORS, AUTH_SECRET, APP_ENCRYPTION_KEY, ANTHROPIC_API_KEY, HF_TOKEN, BACKUP_AGE_RECIPIENT + R2_BACKUP_*; GHL_* when leaving manual publish; SLACK_SIGNING_SECRET for /handbook.
