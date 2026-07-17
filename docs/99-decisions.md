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

## 2026-07-17 — Scheduler publishes manual-first; GHL is a pluggable adapter behind creds
**Context:** docs/06 publishes through GHL's Social Planner, but GHL is deferred until we have it (same posture as the Leads GHL connector). The planning/approval brain must be fully usable now.
**Decision:** `lib/scheduler/publish.ts` defines a `PublishAdapter` interface. The default `manualAdapter` marks a due post `published` (the team posts by hand; the calendar is the plan-of-record) — manual-first, like Leads. `PUBLISH_MODE=ghl` + GHL creds swap in the `ghlAdapter` (the single rewrite point per the doc; currently a stub that errors clearly). A `cron` `publish-sweep` every 2 min enqueues `publish-post` jobs for due `scheduled` posts; failures flip status to `failed` and page Slack.
**Alternatives considered:** blocking the whole module on GHL — leaves the calendar unusable for months; building direct Meta/TikTok APIs — the doc explicitly rejects this.
**Revisit if:** GHL arrives — implement `ghlAdapter.publish` (create post in the sub-account, attach media URLs, poll for permalink) and set `PUBLISH_MODE=ghl`.

## 2026-07-17 — Media validation at draft time; channel limits in one module
**Context:** docs/06 wants per-channel constraints (IG media, caption limits) checked at draft, not at publish failure.
**Decision:** `lib/scheduler/channels.ts` holds the channel rules (body limits, IG/TikTok media-required) and `validatePost`; the posts service attaches `issues[]` to every returned post and hard-blocks the `scheduled` transition while any issue exists. Six unit tests cover it.
**Alternatives considered:** validating only at publish — the spec explicitly wants earlier feedback.
**Revisit if:** GHL exposes authoritative per-account channel constraints — fold them in.

## 2026-07-17 — Notes transcription: configurable Python worker, on-box, degrades gracefully
**Context:** docs/03 requires faster-whisper (large-v3 int8) + pyannote diarization on our own box; audio must never leave our infra (only text goes to Claude).
**Decision:** `lib/transcribe/index.ts` shells out to `scripts/transcribe.py` (overridable via `TRANSCRIBE_CMD`/`TRANSCRIBE_SCRIPT`), which runs faster-whisper + pyannote and emits diarized segments JSON. The transcribe job pulls audio from R2, runs the script in a temp dir, writes the transcript, and enqueues the `ai` meeting-notes job. `Dockerfile.worker` apt-installs python3 + pip-installs the deps. Without `HF_TOKEN`, diarization degrades to a single `SPEAKER_00` so notes still generate.
**Alternatives considered:** a Node whisper binding — the mature int8 CPU path is Python; a hosted transcription API — violates the on-box privacy rule.
**Revisit if:** GPU transcription is needed at volume (docs/00 GPU upgrade path).

## 2026-07-17 — This environment can't run whisper/Claude; Notes verified for wiring + logic
**Context:** No faster-whisper/pyannote and no ANTHROPIC_API_KEY in this build env, and the R2 stub stores nothing.
**Decision:** The Claude notes contract (`notesSchema`) is unit-tested (audit item 8 injection boundary). The pipeline was verified end-to-end for *wiring*: `transcribe-meeting` reaches the R2 fetch and `meeting-notes` reaches the Claude call, both failing loudly into `job_runs`. Feature behavior (full-text search, action-items→tasks, speaker rename) was verified against a seeded transcript. Real transcripts/notes need the worker image's Python deps + `ANTHROPIC_API_KEY` + real R2.
**Alternatives considered:** mocking the whole pipeline in CI — the seeded-transcript approach exercises the real services and DB.
**Revisit if:** CI gains the Python deps + a test API key — then an integration test can transcribe a short clip end to end.

## 2026-07-17 — Transcript full-text search computed at query time (stored tsvector deferred)
**Context:** `db/schema.sql` defines a stored `tsvector` generated column + GIN index on transcripts; drizzle-kit doesn't model generated tsvector columns cleanly.
**Decision:** Compute `to_tsvector('english', segments::text)` at query time with `ts_headline` snippets. Correct and fine at current volume.
**Alternatives considered:** a custom Drizzle type + hand-written migration for the stored column — more moving parts than the data warrants today.
**Revisit if:** transcript volume makes on-the-fly tsvector slow — add the stored column + GIN index as a follow-up migration (the SQL file already specifies it).

## 2026-07-17 — Shared media rail: ffmpeg wrappers + FFMPEG_PATH, worker installs ffmpeg
**Context:** Weeks 4 (asset thumbnails) and 5 (HLS transcode + sprite sheets) both need ffmpeg. The app image must not carry it (rule 5: the app never touches bytes).
**Decision:** `lib/media/ffmpeg.ts` wraps a full ffmpeg (image/video thumbnail, sprite sheet, HLS ladder) with a hard timeout; `FFMPEG_PATH`/`FFPROBE_PATH` env overrides the binary. `Dockerfile.worker` apt-installs ffmpeg; the app image does not. `lib/media/jobs.ts` runs only in the worker: pull source from R2 → process in a temp dir → push derived objects → update the DB row. Media jobs are `media`-queue jobs with retries and `job_runs`.
**Alternatives considered:** a Node image library (sharp) for thumbnails — still need ffmpeg for video/HLS, so one tool covers both; running ffmpeg in the app — violates the no-bytes-in-app rule and blocks the request path.
**Revisit if:** GPU transcode is needed at volume (docs/00 notes a GPU box upgrade path).

## 2026-07-17 — This environment's ffmpeg is minimal; media verified for wiring only
**Context:** The only ffmpeg available in this build environment is the Playwright-bundled one (image2 demux only — no h264/mjpeg/aac encoders, no lavfi/hls), and there is no real R2 (an S3 stub that stores nothing stands in).
**Decision:** The ffmpeg wrapper tests are capability-gated (skip encode/transcode assertions when only a minimal ffmpeg is present; `mediaKind` always runs). End-to-end media processing was verified for *wiring*: both `asset-thumbnail` and `review-transcode` jobs execute, pull from the R2 stub, and reach the real ffmpeg invocation (failing loudly into `job_runs` on the minimal encoder). Real thumbnails/HLS require the full ffmpeg the worker image installs + real R2.
**Alternatives considered:** shipping a bundled ffmpeg binary — large and platform-specific; the Docker image is the right place.
**Revisit if:** CI gains a full ffmpeg — then the wrapper tests exercise real encode/transcode and an integration test can round-trip against MinIO.

## 2026-07-17 — Review actor model: authenticated user OR share-link guest
**Context:** docs/01 comment/approval routes accept "auth or valid share token". Guests have no session.
**Decision:** An `Actor` is `{type:"user"}` or `{type:"guest", shareLinkId, guestName, itemId, canComment}`. `resolveActor` prefers a signed-in user, else resolves a share token (unexpired, targeting the version's item). Comment/approval routes are plain handlers (not `withViewer`) that resolve the actor from the session or the request body's `shareToken`+`guestName`. Share PIN attempts are rate-limited 5/15min per token+IP with lockout + owner notification; the public payload mints ≤15-min signed R2 URLs per request (audit item 1) — revoking a link expires it so signed URLs die naturally.
**Alternatives considered:** a separate guest-comment endpoint — duplicates logic; the spec wants one route.
**Revisit if:** guests should get their own rate limits on comment volume (add a per-token comment cap).

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
