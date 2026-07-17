# 99 — Decisions Log

Append-only. Every judgment call made during implementation gets a row — anything the specs didn't dictate: library picks, schema tweaks, behavior choices, deferred work. Newest first. Claude Code: add an entry in the same commit as the decision; humans: review this file weekly.

Format:

```
## YYYY-MM-DD — Short title
**Context:** what forced a choice (spec silent/conflicting, technical constraint)
**Decision:** what was done
**Alternatives considered:** briefly
**Revisit if:** the condition that would reopen this
```

---

## 2026-07-17 — Leads are internal-only in Week 3; portal leads page deferred
**Context:** docs/02 describes an optional per-account client portal leads page (`portal_leads: off|summary|full`), but the roadmap puts the whole client portal in Week 10 (doc 11).
**Decision:** All pipeline/stage/lead routes and services are internal-only (admin/member). Clients get 403; the route-matrix proves it. `accounts.portal_leads` and `leads.client_hidden` columns exist and are respected in writes, but no client-facing read path is wired yet.
**Alternatives considered:** building the summary/full portal views now — premature before the portal shell exists.
**Revisit if:** Week 10 portal (doc 11) — wire the read-only summary/full views then, honoring `client_hidden` and stripping internal-only fields.

## 2026-07-17 — Pipelines always belong to an account (no null-account pipeline)
**Context:** docs/02 says the agency tracks its own prospects; I initially modeled that as a null-account pipeline. `db/006-leads-manual.sql` makes `pipelines.account_id NOT NULL`.
**Decision:** Every pipeline has an account. The agency's own prospect pipeline lives under the agency's internal account (a real account row). `leads.account_id` stays nullable per the base schema but is derived from the pipeline on create.
**Alternatives considered:** relaxing the FK to nullable — diverges from the spec SQL, which is law (CLAUDE.md rule 1).
**Revisit if:** never, unless the schema SQL changes.

## 2026-07-17 — Lead scoring model + dropped temperature
**Context:** prompts/lead-scoring.md frontmatter names `claude-sonnet-4-6` at `temp 0`. That model's successor is `claude-sonnet-5`, on which non-default sampling params (temperature) are rejected by the API (400).
**Decision:** Model is `LEAD_SCORING_MODEL` env, defaulting to `claude-sonnet-5`. The prompt *text* is loaded verbatim from prompts/lead-scoring.md (CLAUDE.md rule 6); `temperature` is omitted. Output is Zod-validated JSON with one retry, then the job fails loudly (rule 6). The extraction is a security boundary (audit item 8): Zod strips any injected extra fields.
**Alternatives considered:** pinning `claude-sonnet-4-6` to honor the frontmatter literally — it still works, but the current Sonnet is the better default; keeping temperature — a guaranteed 400 on the default model.
**Revisit if:** a newer scoring-appropriate model ships, or structured-output (`output_config.format`) is preferred over parse-with-retry.

## 2026-07-17 — Public intake honeypot passes schema, drops at the service
**Context:** Audit item 6 wants a honeypot on the public intake form. A Zod `max(0)` on the honeypot field would reject bots with a distinct 400, letting them detect and strip the field.
**Decision:** The honeypot (`website_url`) is an ordinary optional string in the schema; `ingestIntake` drops any submission that filled it and still returns a 200, indistinguishable from a real success. Per-IP rate limiting, a 16KB body cap, and identical responses for unknown tokens round out the endpoint.
**Alternatives considered:** `max(0)` schema rejection — leaks the honeypot via a distinct error.
**Revisit if:** Turnstile is wired (env keys already present) — add server-side verification alongside the honeypot.

## 2026-07-17 — Custom Auth.js adapter instead of @auth/drizzle-adapter
**Context:** Only the email (magic link) provider with database sessions is used; the stock Drizzle adapter demands an oauth `accounts` table whose name collides with the domain `accounts` (client companies) table.
**Decision:** ~80-line custom adapter (`lib/auth/adapter.ts`): users + sessions + verification_tokens only. `createUser` throws — sign-ups are invite-only; delivery is already gated on an existing user. Schema gained `users.email_verified`, `sessions`, `verification_tokens` (db/schema.sql updated same commit).
**Alternatives considered:** stock adapter with a renamed `auth_accounts` table — dead table, more surface.
**Revisit if:** an OAuth provider (Google SSO for the team) is ever added.

## 2026-07-17 — Dev mailbox for magic links when SMTP_URL is unset
**Context:** Local dev and Playwright need to complete the magic-link flow without an SMTP server; production must never silently skip email.
**Decision:** Without SMTP_URL, links/invites are written to `.dev-mail/*.txt` (gitignored) and logged. In production this throws unless `DEV_MAILBOX=1` (the e2e escape hatch for testing the prod build).
**Alternatives considered:** MailHog container — heavier, another service to run; exposing tokens via an API — a security hole waiting to be forgotten.
**Revisit if:** e2e moves to a real SMTP sandbox.

## 2026-07-17 — Magic-link requests for unknown emails are silently dropped
**Context:** Audit item 3 requires identical responses whether an email exists or not; Auth.js's signIn callback would redirect to an error page (enumerable).
**Decision:** `sendVerificationRequest` checks rate limits (3/email, 10/IP per 15 min) and user existence, and silently drops on failure. Every requester sees "check your email".
**Alternatives considered:** blocking in the signIn callback — leaks existence via the error redirect.
**Revisit if:** support burden from "I never got my link" outweighs enumeration risk.

## 2026-07-17 — Week-1 access rules: clients read-only, spine mutations internal-only
**Context:** docs/00 defines visibility rules but is silent on client writes to spine records.
**Decision:** `canMutateAccount` returns false for clients regardless of membership; client uploads/comments arrive with their modules (portal, review dropbox). Unflagged spine records (projects, files) are visible to clients of that account; flagged records require `client_visible`.
**Alternatives considered:** per-record write flags now — speculative before any module needs them.
**Revisit if:** Review/Portal specs land client-side writes (they do — revisit then).

## 2026-07-17 — Membership role mirrors invite role; member invites limited
**Context:** Spec doesn't say who may mint which role.
**Decision:** Members can invite clients; only admins can create member/admin users. Invite emails point at /login (magic link does the rest, no invite-token machinery).
**Alternatives considered:** invite tokens with expiry — redundant when magic links already gate on email ownership.
**Revisit if:** contractors with scoped permissions arrive (doc 12B).

## 2026-07-17 — S3 stub + R2_ENDPOINT override for dev/e2e uploads
**Context:** Presigned-upload flow needs an S3 target locally; no R2 creds in dev, and the browser PUT is cross-origin.
**Decision:** `R2_ENDPOINT` env points the S3 client anywhere (MinIO, or `tests/s3-stub.ts` — a 50-line stub with CORS that accepts PUTs). Production note: the real R2 bucket needs a CORS rule allowing PUT from APP_URL and exposing ETag, or browser uploads fail exactly like the stub did before CORS was added.
**Alternatives considered:** MinIO in compose — right for staging, overkill for CI smoke.
**Revisit if:** multipart e2e coverage needs real byte assembly.

## 2026-07-17 — `cron` queue for time-driven internal jobs
**Context:** docs/00 defines five queues (media/transcribe/ai/ghl/publish) for heavy work. Recurring-task spawning and the daily digest are clock-driven and fit none of them.
**Decision:** Added a sixth `cron` queue with two repeatable jobs — `spawn-recurring` (every 5 min) and `daily-digest` (08:00 daily). BullMQ dedupes repeatable jobs by jobId, so restarts don't stack schedules. Jobs still record `job_runs` and surface in /admin/health like every other queue.
**Alternatives considered:** a system cron hitting an internal HTTP endpoint — bypasses the job_runs/retry rails; overloading the `ai` queue — semantically wrong.
**Revisit if:** job volume warrants a dedicated scheduler service (e.g. a real cron container) or BullMQ's repeatable-job model proves limiting.

## 2026-07-17 — Hand-rolled RRULE evaluator instead of the `rrule` package
**Context:** Recurring rules need RRULE support; docs name FREQ=WEEKLY;BYDAY=…, monthly "every 1st", weekly prep.
**Decision:** A ~90-line `lib/rrule.ts` covering FREQ=DAILY|WEEKLY|MONTHLY with INTERVAL, BYDAY, BYMONTHDAY, computed in UTC, with 9 unit tests. `startAt` is the first fire time; `nextOccurrence` only advances after each spawn.
**Alternatives considered:** the `rrule` npm package — full RFC 5545 but a heavier dependency than the stated needs require.
**Revisit if:** a rule needs BYHOUR/BYSETPOS/COUNT/UNTIL or timezone-aware expansion — then adopt `rrule` and port the tests.

## 2026-07-17 — Tasks are internal-authored; clients read `client_visible` only
**Context:** docs/04 says clients see only `client_visible` tasks "used sparingly"; it doesn't spell out client writes.
**Decision:** All task create/update/comment operations require an internal role. Clients get read access to `client_visible` tasks in their own accounts (list filters and single-GET both enforce it); everything else is 404 for them, mutations 403. Proven by the route-matrix test.
**Alternatives considered:** letting clients comment on their visible tasks — deferred to the portal spec (doc 11) where client interaction is designed properly.
**Revisit if:** the portal introduces client-side task interaction.

## 2026-07-17 — Route-matrix test as the CI isolation gate (audit item 5)
**Context:** Audit item 5 demands an automated matrix proving cross-account isolation, "the highest-value test in the codebase."
**Decision:** `tests/route-matrix.ts` (run via `pnpm test:matrix`) mints DB sessions for admin/member/client-of-A/anon and probes 14 route cases across two accounts, asserting cross-account reads are 404 and unauthorized mutations 403/401 — 56 checks. Runs against a live server.
**Alternatives considered:** per-route unit tests — don't exercise the real auth/cookie path end to end.
**Revisit if:** CI should fail when a *new* route lacks matrix coverage — that enforcement (a registry check) is still TODO; today the matrix must be extended by hand per new route.

## 2026-07-16 — Log created
**Context:** Spec pack handoff; drift across Claude Code sessions needs a paper trail.
**Decision:** All `// DECISION:` comments in code must have a matching entry here.
**Alternatives considered:** PR descriptions only — rejected, they don't survive squashes.
**Revisit if:** Never.
