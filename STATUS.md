# STATUS — through Week 2: Tasks

_Last session: 2026-07-17. Read this first next session (HANDOFF.md rule)._

## Week 2 — Tasks module (docs/04) — COMPLETE

All five build-checklist items ticked in docs/04:

- **Schema + CRUD + My Tasks** — tasks/task_checklist/task_comments/recurring_rules in Drizzle (migration 0001; tables were already in `db/schema.sql`). Task service with filters (assignee/account/project/status + due buckets overdue/today/week), priority ranking, `client_visible` read-scoping. My Tasks view buckets overdue/today/this-week/later.
- **Project board** — kanban per account/project at `/tasks/board`, HTML5 drag between the five statuses with optimistic column moves.
- **Comments + mentions + digests** — threaded-once comments; `@email` mentions notify; notify-on-assign; daily per-member Slack+bell digest (overdue/today/awaiting-review), one notification per member not per-task.
- **Recurring rules cron** — `lib/rrule.ts` evaluator (daily/weekly/monthly, 9 tests); `spawn-recurring` repeatable job every 5 min; `POST /api/recurring-rules`.
- **Workload** — est-hours-due-this-week per member with green/yellow/red load bar at `/tasks/workload`.
- **Account view** — open-tasks card on the account detail page (status-call agenda).

Routes: `GET/POST /api/tasks`, `GET/PATCH /api/tasks/:id`, `POST /api/tasks/:id/comments`, `POST/PATCH /api/tasks/:id/checklist[...]`, `GET/POST /api/recurring-rules`. Members now land on My Tasks; clients still land on Accounts.

### New this week
- **Route-matrix test (audit item 5)** — `pnpm test:matrix` → `tests/route-matrix.ts`. Mints DB sessions for admin/member/client-of-A/anon and probes 14 route cases across two accounts (56 checks). This is the isolation gate the audit calls the highest-value test.
- **`cron` queue** — sixth BullMQ queue for clock-driven internal jobs (recurring + digest); records job_runs, surfaces in /admin/health.

### Bugs caught & fixed during verification
- Unknown/no-op task status updates produced an empty Drizzle patch → 500. `updateTask` now returns the task unchanged when nothing differs. (Caught by route-matrix.)
- Recurring `startAt` was pushed a full interval into the future; it's now the first fire time, with `nextOccurrence` only advancing after each spawn. (Caught driving the job directly.)

## Verified this session (real Postgres + Redis)
- Unit: 21 pass (access rules 12, rrule 9). E2e: 3 pass (week-1 path, magic-link single-use, tasks flow). Route-matrix: 56/56.
- Drove recurring spawn (1 task created, source=recurring) and digest (overdue task counted) directly against the DB.

## How to run (unchanged from week 1, plus)
```bash
pnpm test          # vitest: access + rrule
pnpm test:matrix   # route-matrix (needs running app + DB)
pnpm build && pnpm test:e2e   # playwright (CHROMIUM_PATH=/opt/pw-browsers/chromium in this env)
pnpm worker        # includes cron schedules (spawn-recurring, daily-digest)
```
Local infra note: in this container Postgres/Redis are reclaimed between idle periods — restart with `pg_ctl ... start` and `redis-server --daemonize yes` (see scratchpad env.sh). In production they're managed Docker Compose services.

## Next (Week 3 — Leads, manual-first, docs/02)
- Pipelines/stages CRUD, lead cards + kanban/table/drawer, CSV import + public intake endpoint (audit item 6: Turnstile+honeypot+rate limits), all-accounts overview, AI scoring (prompts/lead-scoring.md). GHL connector deferred (doc 02 appendix).
- The meeting→task bridge (`source=meeting`) and review→task bridge land with Notes (wk6) and Review (wk5); task `source`/`source_id` columns already support them.

## Carrying forward / needs Ryan
- Route-matrix currently must be extended by hand per new route; automating "new route without coverage fails CI" is still TODO.
- Same env values still needed for deploy: SMTP_URL, R2 creds + bucket CORS (PUT from APP_URL, expose ETag), AUTH_SECRET, APP_ENCRYPTION_KEY.
- Placeholder member emails in seed (`dana@`, `sam@example.com`) — replace with real team.
