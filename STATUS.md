# STATUS — Week 1: Platform Core

_Last session: 2026-07-17. Read this first next session (HANDOFF.md rule)._

## Done (all 9 HANDOFF items)

1. **Scaffold** — Next.js 15 App Router, TS strict, Tailwind v4, Drizzle, BullMQ, layout per CLAUDE.md (`app/(app)/`, `lib/services/`, `lib/access.ts`, `workers/`). Minimal shadcn-style primitives in `components/ui.tsx` (swap for generated shadcn when theming lands).
2. **Docker Compose** — app, worker, postgres:16, redis (requirepass), caddy (TLS+HSTS). DB ports unpublished in prod; `docker-compose.override.yml.example` publishes them on loopback for local dev.
3. **Schema** — spine + files + notifications + job_runs in Drizzle; migration verified on fresh Postgres 16. Auth.js additions (sessions, verification_tokens, users.email_verified) reflected in `db/schema.sql`.
4. **Auth** — Auth.js magic links, custom email-only adapter, invite-only sign-in, 10-min single-use tokens, per-email+per-IP rate limits, identical responses (no enumeration), 30-day DB sessions. Seed: admin `ryan@vngrd.media` (override `SEED_ADMIN_EMAIL`), 2 placeholder members, Demo Account + client user.
5. **Access layer** — pure rules + viewer loader, 12 Vitest tests green. Cross-account denials read as 404.
6. **Spine CRUD** — accounts/projects/users/memberships services + Zod routes + UI (accounts list/detail, team page, invite flows for members and clients).
7. **Files** — presigned R2 PUT (multipart >100MB), 15-min presign TTL, `files` registration, browser upload component. `R2_ENDPOINT` override for MinIO/stub.
8. **Notifications** — table + dispatcher (`notify()`), in-app bell (30s poll), Slack webhook mirror.
9. **Health** — `/admin/health` (admin-only): queue depths, last errors, recent job_runs. Worker records every job in `job_runs` (ok/retrying/failed).

## Verified end-to-end (this session, real Postgres+Redis)

Magic-link login as admin → create account → create project → invite member (team page) → invite client contact (account page) → upload file via presigned URL → file listed → `/admin/health` renders queue + job data. Client-role probes: sees only own account; cross-account GETs → 404; mutations → 403; anonymous → 401. Job pipeline: heartbeat ok; unknown job records `retrying`→`failed` rows with errors. Playwright smoke (2 tests) covers the definition-of-done path + magic-link single-use.

## How to run

```bash
cp .env.example .env   # fill DATABASE_URL/REDIS_URL/AUTH_SECRET at minimum
pnpm install
pnpm db:migrate && pnpm db:seed
pnpm dev               # app
pnpm worker            # BullMQ workers
# tests
pnpm test              # vitest (access rules)
pnpm build && pnpm test:e2e   # playwright smoke (uses .dev-mail + tests/s3-stub.ts)
# CHROMIUM_PATH=/path/to/chromium pnpm test:e2e  # if using a system browser
```

No SMTP? Magic links land in `.dev-mail/last-link.txt` (dev only; prod requires SMTP_URL).

## Next (Week 2 — Tasks module, docs/04)

- Full Tasks module per docs/04-tasks.md.
- Route-matrix CI test (audit item 5) — the curl probes above should become an automated matrix run in CI before more routes land.
- Real R2: create bucket + CORS rule (allow PUT from APP_URL, expose ETag) — see decisions log.

## Blocking / needs Ryan

- Confirm seed admin email (`ryan@vngrd.media` assumed from session; `SEED_ADMIN_EMAIL` overrides).
- Real env values when deploying: SMTP_URL, R2 creds, AUTH_SECRET, APP_ENCRYPTION_KEY.
- Placeholder member emails in seed (`dana@example.com`, `sam@example.com`) — replace with real team.
