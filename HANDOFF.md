# HANDOFF — Week 1 Kickoff Prompt for Claude Code

Copy everything below the line into Claude Code from the repo root (this folder, unzipped).

---

Read CLAUDE.md fully, then docs/00-architecture.md, then docs/07-roadmap.md. You are building Week 1: the platform core. Do not build any module features yet.

Scope for this session series, in order:

1. **Scaffold:** Next.js 15 App Router + TypeScript strict, Tailwind + shadcn/ui, Drizzle, BullMQ, folder layout per CLAUDE.md (app/(app)/, lib/services/, lib/access.ts, workers/).
2. **Docker Compose:** app, worker, postgres:16, redis, caddy. `.env.example` with every var from docs/00. Local dev must run with `docker compose up` + `pnpm dev`.
3. **Schema:** implement db/schema.sql in Drizzle (spine + files + notifications + job_runs ONLY for now — module tables come with their modules). Migration runs clean on fresh Postgres.
4. **Auth:** Auth.js magic-link email via SMTP_URL. Roles admin/member/client on users. Seed script: one admin (my email — ask me), two members, one demo client account with a client user.
5. **Access layer:** lib/access.ts implementing the role rules from docs/00 (admin/member see all; client sees memberships + client_visible). Vitest coverage on every rule before anything uses it.
6. **Spine CRUD:** accounts, projects, users, memberships — services + routes + minimal UI (accounts list/detail, team settings page, invite flow for members and clients).
7. **File service:** presigned R2 upload (multipart for >100MB), files table registration, browser upload component. No media processing yet.
8. **Notifications:** table + dispatcher with in-app bell and Slack webhook channel (simple webhook for now; the full Slack app is doc 15, later).
9. **Health:** /admin/health showing job_runs, queue depths, last errors.

Working rules for this and every future session:
- One roadmap item per session where possible; commit per checklist item; tick items in the module doc in the same commit.
- Any judgment call → `// DECISION:` comment + entry in docs/99-decisions.md, same commit.
- End each session by writing a short STATUS.md at root: what's done, what's next, anything blocking. Read it first next session.
- Definition of done for Week 1: fresh clone → docker compose up → migrate → seed → I can log in via magic link as admin, create an account, invite a member, upload a file, see it in the files table, and see the health page. Playwright smoke test covering exactly that path.

Start by confirming your plan for items 1–3 in a few sentences, ask me for the seed admin email and any missing env values, then build.
