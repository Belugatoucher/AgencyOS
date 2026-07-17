# STATUS — through Week 10: Onboarding + Client Portal + polish

_Last session: 2026-07-17. Read this first next session (HANDOFF.md rule)._

## Week 10 — Onboarding (docs/10) + Portal (docs/11) + roadmap polish — COMPLETE (MVP scope; see checklists)

- **Onboarding** — internal console (`/onboarding`): mint 30-day CSPRNG intake links per account. Public form (`/onboard/[token]`, no login, audit-item-6 hardened: per-IP rate limit, body cap, strict Zod, identical 404s) with partial saves. Submit → ONE pending `brain_suggestions` row (field `intake`; decideSuggestion refuses blind accept). Review & commit screen: member edits every answer, commit writes **Brain v1** through the versioned updater, competitors → `research_docs` stubs (status `stub`, out of retrieval), access gaps → AM tasks, optional **project template** spawns kickoff tasks (+offset_days), content slots, and a kickoff meeting.
- **Portal** — `/portal/[accountId]` client-skinned shell (Home/Reviews/Content/Files/Meetings); clients land there on login (single membership) — a filtered view over existing role checks, no new permission logic. Home = action-needed stack (reviews awaiting, posts awaiting, visible tasks) with the "You're all caught up" empty state. Reviews reuse `ReviewItemClient` with team controls hidden. Content: read-only list with Approve / Request-changes; **rejections require ≥1 {current, proposed} line suggestion** (stored on `post_approvals.suggestions`). Files: shared collections. Meetings: `client_visible` recaps, summary only. Client actions ping the team Slack.
- **Review hardening (found during portal work)** — the comments GET authorized any signed-in user (cross-account leak): now per-actor authorization (404 cross-account, matrix-covered). New `review_comments.internal` flag: internal threads are role-filtered from clients/guests everywhere (API + public share payload); only internal actors can write internal comments.
- **Weekly client digest** — cron Fri 08:30, per-account `portal_digest` weekly|off, quiet weeks skipped; "needs your eyes" computed via a synthetic client viewer through `getPortalHome`, so the digest can never say more than the portal shows. SMTP with dev-mailbox fallback + in-app notification.
- **Polish** — search-everywhere bar in the header (`/api/search`: accounts/tasks/leads/assets/meetings+transcript-FTS/posts/reviews, internal only). `/admin/health` already covers new queues generically. `scripts/backup.sh` (pg_dump+gzip, optional age encryption, optional write-only-R2 upload) + `scripts/restore-check.sh`.

Schema (migrations 0007-0008, SQL files updated in kind): `intake_forms`, `project_templates` (from db/003), `post_approvals.suggestions`, `accounts.portal_digest`, `review_comments.internal`.

Routes: `GET/POST /api/onboarding/intakes` (+`/[id]/commit`), `GET/POST /api/onboarding/templates`, `GET/POST /api/onboarding/form/[token]` (public), `GET /api/portal/[accountId]` (+`/meetings`), `GET /api/search`. Nav: Onboarding tab; portal is its own route group.

## Verified this session (real Postgres + Redis, prod build)
- Unit: **60 pass**. E2e: **11 pass** (+portal spec: admin intake link → public form fill/partial-save/submit → review & commit; then a REAL client session minted in the DB: lands in portal, sees action stack, blocked from /tasks, approves a post). Route-matrix: **276/276** (+48: onboarding internal + public-token cases, portal cross-account 404s / own-account 200s, comment-read leak regression, bare-rejection 400, search internal-only).
- Commit side effects checked in the DB: Brain v1 offer written (version bumped), competitor stub `Acme Clinics Co(stub)`, gap task "Get access: Meta ad account".
- `sendClientDigests()` executed live: 4 accounts, real digest bodies in dev-mail.
- **Restore drill actually ran**: backup taken, restored into a scratch DB — 44 tables, 8 users — then dropped.

## How to run (unchanged, plus)
```bash
pnpm test          # 60 unit
pnpm test:matrix   # 276-check route matrix (needs running app + DB)
pnpm build && pnpm test:e2e   # 11 playwright specs (prod build — dev-mode CSP note in decisions)
pnpm worker        # + cron: client-digest (Fri 08:30)
./scripts/backup.sh && ./scripts/restore-check.sh   # backup + monthly drill
```

## Next (Weeks 11-12 — Academy, docs/16)
SOP library + staleness engine, courses/lessons reusing the media + whisper pipelines, role-based assignments + completion matrix, quizzes, Notebook chat on the kb scope. Tables in db/004-academy.sql. Rides existing rails (files/media workers, RAG layer from wk8, notifications) — per the scope-creep rule this should be cheap.

## Carrying forward / needs Ryan
- **AI features need `ANTHROPIC_API_KEY`**: lead scoring, meeting notes, content drafting, Ask the Brain. Transcription needs whisper/pyannote + `HF_TOKEN`. `EMBED_MODE=local` in prod.
- Deferred this week: brand-asset drop-box on the intake (needs public presign), portal theme proposal from logo (doc 14), portal Documents page (doc 17 module), portal Leads page (doc 02 pass; `portal_leads` setting exists), "what changed in v2" review diffs, composer per-suggestion accept/decline UI, custom portal domains.
- Media + transcription remain wiring-verified only in this env; embeddings/retrieval verified for real.
- Route-matrix hand-extended per new route (automation still TODO). Now 276 checks.
- Standing deploy needs: SMTP_URL, R2 creds + CORS, AUTH_SECRET, APP_ENCRYPTION_KEY, ANTHROPIC_API_KEY, HF_TOKEN; GHL_* when leaving manual publish; BACKUP_AGE_RECIPIENT + R2_BACKUP_* for encrypted off-site backups.
