# Agency OS

One internal platform to run the agency. Six modules on a shared core: clients, projects, and people exist once, and every module hangs off them.

## Modules

| # | Module | Replaces |
|---|--------|----------|
| 1 | Review | Frame.io — video/asset review with client comments |
| 2 | Leads | Spreadsheets + GHL tab-switching — pipeline dashboard with two-way GoHighLevel sync |
| 3 | Notes | Otter/Fireflies — private AI note taker for calls, in-person meetings, and uploads |
| 4 | Tasks | ClickUp/Asana — task and project management |
| 5 | Assets | Google Drive chaos — tracked asset library with assignment and usage status |
| 6 | Scheduler | Native platform posting — content calendar that publishes through GHL Social Planner |
| 7 | Intelligence | Notion swipe files + scattered research — hooks DB, winning creatives, research library, and a per-client "Brain" content AI (RAG over all of it) |
| 8 | Metrics | CSV/API ingestion feeding Intelligence + Reports (doc 09) |
| 9 | Onboarding | Intake wizard that populates the Brain + brand kit + kickoff tasks (doc 10) |
| 10 | Portal | Client-facing view over Review/Content/Files/approvals (doc 11) |
| — | v1.5 | Reports, audit log + scoped permissions, proposals/invoicing integrations (doc 12) |

Plus a client portal that stitches Review, Assets, and approvals into one client-facing view per account.

## Stack (decided)

- **App:** Next.js 15 (App Router) + TypeScript, single monolith
- **Database:** PostgreSQL 16, Drizzle ORM
- **Jobs:** BullMQ + Redis (transcoding, transcription, GHL sync, publishing)
- **Storage:** Cloudflare R2 (S3-compatible) with presigned direct uploads
- **Transcription:** faster-whisper running on your own server. Audio never leaves your infrastructure.
- **AI:** Anthropic API for summaries, action items, lead scoring, content repurposing
- **Auth:** Auth.js, magic-link email. Roles: `admin`, `member`, `client`
- **Hosting:** One Hetzner or DigitalOcean VPS (8 vCPU / 16GB, ~$50/mo), Docker Compose, Caddy for TLS. Coolify on top if you want push-to-deploy.

Why a VPS and not Vercel: video transcoding, Whisper transcription, and long-running sync workers need a real machine. Vercel's serverless limits fight you on all three. One box runs the app, workers, Postgres, and Redis for a 2–5 person team with room to spare. Nightly `pg_dump` to R2 covers backups.

## Reading order

1. `docs/00-architecture.md` — shared core, auth, data model spine, job system
2. `docs/01-review.md` through `docs/06-scheduler.md` — one file per module
3. `docs/07-roadmap.md` — build order, 8-week plan
4. `db/schema.sql` — full consolidated schema, runnable
5. `prompts/` — production system prompts for every AI feature

## How to use this pack

Each module doc contains the data model, API routes, user flows, edge cases, and a build checklist. Hand a doc plus `00-architecture.md` to Claude Code and it has everything needed to implement that module. The roadmap tells you which order to do that in.
