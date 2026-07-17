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

## 2026-07-17 — Stripe for DIY courses: dependency-free client, webhook → billing queue, inline prices
**Context:** Requested Stripe checkout for the paid DIY section (db/008 left a webhook slot). CLAUDE.md rule 4: webhook handlers verify, enqueue, 200 in <1s. The codebase's integration posture is plain fetch + manual HMAC (Slack, GHL) — no SDKs.
**Decision:** db/009: `courses.price_cents` (prices live in our DB; Checkout Sessions use inline `price_data`, so no Stripe dashboard products to sync) + `course_purchases` (unique `stripe_session_id` = the idempotency key). `lib/stripe.ts` is dependency-free: Checkout Session creation via the REST API, and a pure v1 signature verifier (HMAC-SHA256 over `t.payload`, 5-min tolerance, constant-time, multi-`v1` for key rolls) with a `signStripePayload` helper so tests/e2e can sign synthetic events. Flow: public `/diy` storefront → rate-limited `/api/diy/checkout` (501 unconfigured) → Stripe → `/api/stripe/webhook` verifies + enqueues `stripe-entitle` on a new `billing` queue (BullMQ jobId = session id dedupes redeliveries) → the job grants the entitlement (`source='stripe'`, same insert as manual grants), records the purchase, creates the learner + sends the sign-in pointer. Only `checkout.session.completed` with `payment_status=paid` fulfills; malformed-but-signed events are acknowledged + logged so Stripe stops retrying.
**Alternatives considered:** the `stripe` npm SDK — one endpoint + one verifier doesn't justify it; fulfilling inline in the webhook — works but loses rule-4 posture and job_runs retry visibility; Stripe Products/Prices — a second source of truth to drift.
**Revisit if:** subscriptions/refunds arrive (SDK earns its keep; refund webhook should set `revoked_at` on the entitlement) or multi-currency pricing is needed.

## 2026-07-17 — Global input sanitization layer + snippet XSS fix
**Context:** Requested hardening pass. Zod already gates shape/size on every boundary, but nothing handled control characters, Unicode bidi/zero-width spoofing, or the one place raw HTML reached the DOM: the meeting-search snippet (`ts_headline` output rendered via dangerouslySetInnerHTML — a live XSS vector through transcript text).
**Decision:** `lib/sanitize.ts` — `deepSanitize` strips C0/C1 controls (keeping \n/\t), bidi overrides/isolates, and zero-width chars from every string in every JSON body, wired into `parseBody` (plus a 2MB body cap) so ALL routes get it before Zod. Output side: `ts_headline` now emits sentinel markers; `safeHighlight` HTML-escapes the whole snippet first and only then converts sentinels to `<b>` — injected markup can't survive. The public login/intake routes that bypass parseBody call deepSanitize directly.
**Alternatives considered:** a sanitizer library (DOMPurify et al) — we render no user HTML anywhere, so escaping + character stripping covers the actual surface without a dependency.
**Revisit if:** user-authored rich text/markdown rendering lands (then add proper markdown sanitization at render).

## 2026-07-17 — Portal password login: scrypt + minted DB sessions beside magic links
**Context:** Requested username/password sign-in for portal clients. Auth.js credentials providers don't play well with database sessions, and magic links must remain.
**Decision:** `users.password_hash` (nullable — password is opt-in), scrypt (N=2^15, per-password salt, constant-time compare, `scrypt$salt$hash` format; node:crypto, no new dependency). Login route verifies and mints a row in the same `sessions` table Auth.js reads, setting the same cookie (secure-prefixed on https) — one session pipeline, two front doors. Posture mirrors the magic-link audit items: per-email (5/15min) + per-IP (20/15min) limits, identical 401s for unknown email / no password / wrong password, and a dummy scrypt verify on missing users so timing doesn't enumerate. Set/rotate at portal Settings after any signed-in session; min length 10, no composition rules.
**Alternatives considered:** Auth.js Credentials provider — JWT-session oriented, fights the database-session strategy the audit chose; bcrypt — another dependency for no gain over scrypt.
**Revisit if:** MFA is wanted (TOTP slots in beside the password check) or password reset by email is needed (magic link already IS the reset path).

## 2026-07-17 — Paid DIY courses: entitlement rows, manual grants first, payments later
**Context:** Requested a paid-access Academy section. No payment processor is wired yet.
**Decision:** `courses.access` internal|paid + `course_entitlements` (unique user×course, `source` manual|stripe) in db/008. Access rule: internal users see everything; external learners need an entitlement to a PUBLISHED paid course — denials are 404 so entitlement existence isn't probeable, and internal-access courses stay invisible to all externals. Learners are `client`-role users with no memberships; they land on `/learn` (their entitled shelf) and reuse the same lesson/quiz services now guarded by `canUseCourse`. Grants are manual (admin console, by email — creates the user + sends the sign-in pointer); a Stripe webhook later performs the identical insert with `source='stripe'`.
**Alternatives considered:** a new `student` role — ripples through every access check for no isolation gain; per-lesson entitlements — courses are the unit people buy.
**Revisit if:** Stripe lands (webhook + checkout link on a public course page) or courses need expiry/refunds (add `expires_at`/`revoked_at`).

## 2026-07-17 — Local-only hosting is a compose profile, not a fork
**Context:** Request to "fork the repo and rebuild for local-only hosting." GitHub cannot fork a repo into its own account, and this workspace's GitHub access is scoped to this repository only — no new repo can be created or pushed from here.
**Decision:** Local-only is `docker-compose.local.yml` + `.env.local-hosting.example` + docs/20-local-hosting.md on the SAME codebase: MinIO replaces R2 (the S3 client was already endpoint/path-style ready), dev-mailbox or LAN SMTP replaces the mail provider, password login removes day-to-day magic-link dependence, ports bind to loopback, and every cloud key is optional-and-degrades-loudly. A `local-only` branch is pushed as the divergence point if a true split repo is wanted later — but keeping one codebase means every future module lands in both deployments for free.
**Alternatives considered:** a real fork/second repo — permanent double maintenance for what is, in practice, one compose file of difference.
**Revisit if:** the local variant needs to *remove* cloud code paths entirely (air-gapped compliance), at which point mirror to a separate repo and cherry-pick.

## 2026-07-17 — Notebook prompt added as prompts/notebook.md (pack had none)
**Context:** docs/16 specifies the Notebook uses "the same tool-use pattern as Ask the Brain, scoped to kb chunks," but the spec pack shipped no prompt file for it; CLAUDE.md rule 6 wants prompts loaded verbatim from prompts/.
**Decision:** Wrote prompts/notebook.md following the pack's exact conventions (frontmatter, fenced system prompt, tools list, post-processing) so the runtime loads it the same way as every other prompt. The scope wall is enforced twice: in the prompt (rule 2) and structurally — the Notebook's two tools (search_handbook/get_sop) can only reach kb_chunks/sops, and no Ask-the-Brain tool touches kb_chunks.
**Alternatives considered:** inline prompt string in code — breaks the one-place-to-edit convention the pack establishes.
**Revisit if:** the pack later ships an official notebook prompt — replace the body, keep the file.

## 2026-07-17 — Course assignments surface as My-Tasks tasks, not a parallel inbox
**Context:** docs/16: assignments "appear in My Tasks and the Slack morning DM"; the reuse map bans new notification machinery.
**Decision:** An assignment (rule match or manual) creates one idempotent task per user+course ("Complete course: X", sourceId = course id, due = now + due_days) assigned to the learner. The existing daily digest picks it up for the morning DM; completion is tracked separately in lesson_progress (the matrix reads progress, not the task). Rules fire on invite (team.ts hook) and immediately for current role holders when a rule is created.
**Alternatives considered:** a dedicated assignments inbox — exactly the parallel machinery the doc rules out; auto-completing the task when the course finishes — deferred until the course-complete event exists.
**Revisit if:** team tags land (rules currently match role + explicit user ids only).

## 2026-07-17 — /handbook Slack command: signature-verified, disabled-by-default, admin-attributed
**Context:** docs/16 wants `/handbook` anywhere internal; the full Slack app is doc 15 and doesn't exist yet, and Slack user ids aren't mapped to app users.
**Decision:** /api/slack/commands verifies Slack's v0 HMAC (5-min skew window, timing-safe compare) and returns 501 when SLACK_SIGNING_SECRET is unset — never an open endpoint (matrix-covered). Asks run as a synthetic member viewer; gap rows attribute to the first admin until the doc-15 app brings a user directory.
**Alternatives considered:** skipping the endpoint entirely — loses the wiring and the security posture test; email-mapping Slack users via the Slack API — needs the doc-15 bot token anyway.
**Revisit if:** doc 15 lands (map real users, respond in_channel, add /brain).

## 2026-07-17 — Lesson kb chunks carry the window's start_ms; SOP chunks keep their heading inside the text
**Context:** docs/16 wants Notebook citations to jump to the moment in a lesson video and deep-link SOP sections.
**Decision:** Lesson transcripts chunk into ~1000-char windows, each carrying the first segment's start_ms → citations `lesson:<id>@<ms>`. SOP bodies sectionize on markdown headings (GitHub-style slugs) and each chunk keeps its heading line in the text so retrieval sees the section's name; citations `sop:<id>#<anchor>`. Thin-answer threshold for gap tracking is top-similarity < 0.25 under the hash embedder.
**Alternatives considered:** per-segment chunks — too granular, embeddings degrade on 1-line texts.
**Revisit if:** EMBED_MODE=local changes similarity distributions (recalibrate the thin threshold).

## 2026-07-17 — Intake batch commits through the review screen, not decideSuggestion
**Context:** docs/10 wants submissions to land as a brain_suggestions batch AND wants member review-with-edits before anything writes to the Brain. Applying a whole intake through the one-field decideSuggestion path would bypass the edit step.
**Decision:** Submit inserts ONE pending suggestion (field `intake`, proposed = the merged sections) as the audit-trail/pending marker; decideSuggestion refuses to blind-accept that field and points at the onboarding review screen; the commit endpoint takes the member-edited payload, writes Brain v1 through the versioned updater, marks the suggestion accepted, seeds competitor research stubs (status `stub`, kept out of retrieval), turns access gaps into AM tasks, and optionally spawns the kickoff template (tasks + slots + meeting).
**Alternatives considered:** per-field suggestion rows — 9 rows per intake with no way to edit before accept; direct commit without a suggestion row — loses the pending-review trail.
**Revisit if:** annual-refresh intakes land (docs/10 wants a diff against the current Brain, not an overwrite).

## 2026-07-17 — Review comment reads: per-actor authorization + `internal` thread flag
**Context:** Building the portal exposed that GET /api/review/versions/:id/comments authorized only "any signed-in user" — a cross-account read hole — and docs/11 requires internal threads to be invisible to clients.
**Decision:** Added `review_comments.internal` (migration 0008); only internal actors can set it, and listCommentsFor()/the public share payload filter it for clients/guests. The GET route now authorizes per actor (client: membership + client_visible, guest: token↔item match) and returns 404 cross-account — covered by a new route-matrix case.
**Alternatives considered:** inferring "internal" from author role — wrong, internal users also write client-facing comments.
**Revisit if:** threads need per-comment visibility levels beyond internal/client.

## 2026-07-17 — Post rejections require {current, proposed} suggestions
**Context:** docs/11: rejecting a scheduled post asks for line-level suggestions "instead of a bare rejection comment."
**Decision:** `post_approvals.suggestions` jsonb; decidePost returns 400 on a rejection with zero suggestions (any role — the no-vague-feedback gate matches Review's). Client decisions also ping the team Slack. The composer's per-suggestion accept/decline is a UI pass on top of the stored shape — deferred.
**Alternatives considered:** client-only enforcement — the team deserves the same discipline; free-text-only comment — exactly the vagueness the doc bans.
**Revisit if:** the composer suggestion-merge UI lands (then suggestions may need ids/status).

## 2026-07-17 — Weekly client digest: Fri 08:30, quiet weeks skipped
**Context:** docs/11 wants a weekly digest per client contact, settable per account (weekly/off); no day specified.
**Decision:** `accounts.portal_digest` (default weekly); cron Fri 08:30 so "what shipped this week" reads naturally before the weekend; digests with nothing to say are skipped (zero-count digests train people to ignore email). Email via SMTP_URL with the established dev-mailbox fallback; recipients also get an in-app notification. "Needs your eyes" is computed with a synthetic client viewer through getPortalHome, so digest contents can never exceed what the portal itself shows.
**Alternatives considered:** Monday send — reads as a nag list; always-send — noise.
**Revisit if:** per-contact frequency preferences arrive.

## 2026-07-17 — Backup + restore-drill scripts; drill executed in dev
**Context:** Roadmap wk10: "Backups verified by restoring one." docs/98: encrypted dumps, write-only R2 creds, monthly restore test.
**Decision:** `scripts/backup.sh` (pg_dump custom+gzip, age-encrypted when BACKUP_AGE_RECIPIENT set, uploaded via aws-cli with the R2_BACKUP_* write-only creds when present) and `scripts/restore-check.sh` (restore newest dump into a scratch DB, assert >20 tables + users present, drop). The drill ran against the real dev DB: 44 tables and 8 users restored cleanly.
**Alternatives considered:** managed Postgres backups — the stack is one VPS by design (docs/00).
**Revisit if:** data outgrows single-file dumps (switch to wal-g) or compose gains a backup sidecar.

## 2026-07-17 — Pluggable embedder: hash-mode default, bge-small behind EMBED_MODE=local
**Context:** docs/08 names local bge-small (384-dim) for embeddings; dev/CI containers can't fetch the model, and retrieval ordering still needs real verification against pgvector.
**Decision:** `lib/embeddings` is pluggable via `EMBED_MODE`: default `hash` produces deterministic normalized FNV-1a bag-of-words vectors (cosine similarity ≈ lexical overlap, so ordering is genuinely testable end-to-end); `local` shells to `scripts/embed.py` (bge-small-en-v1.5, installed in the worker image). Both are 384-dim, so switching modes needs a re-embed, not a schema change.
**Alternatives considered:** hosted embeddings API — a network dependency and per-token cost for something a local model does; skipping retrieval verification in CI — leaves the pgvector rail untested.
**Revisit if:** prod retrieval quality needs a bigger model (change dim → migration) or CI gets model-cache access.

## 2026-07-17 — Ask the Brain: non-streaming v1, read-only Zod-gated tools, ai_threads audit trail
**Context:** docs/08 wants streaming chat with tool-use retrieval; audit item 8 mandates read-only tools, output gating, and traceability. prompts/client-brain.md names claude-sonnet-4-6 + temps.
**Decision:** `brain-chat.ts` runs a bounded tool loop (8 rounds) with exactly four read-only tools (search_hooks/search_research/search_creatives/get_brain) whose inputs are Zod-parsed before touching services and which run under the human viewer's access scope; every thread persists messages + retrieval IDs to ai_threads. Cross-client anonymization is structural: retrieval scope is this-account + global-library only, so other clients' rows are never fetched. Non-streaming responses in v1 (the UI shows a full reply); model via `BRAIN_CHAT_MODEL` (default current Sonnet), sampling params omitted per the existing lead-scoring decision. Prompt text used verbatim.
**Alternatives considered:** streaming SSE now — pure UI plumbing that doesn't change the safety or retrieval story; letting tools write (e.g. save-hook) — flatly barred by audit item 8.
**Revisit if:** chat latency hurts (add streaming) or the handbook (doc 16) joins retrieval scope (needs the scope-wall rules from docs/08 applied to a second corpus).

## 2026-07-17 — Metrics: db/007-metrics.sql + id-slug ad↔creative matching (no fuzzy fallback yet)
**Context:** docs/09 defines the metric_sources/metric_rows model but the spec pack shipped no SQL file for it (schema is law → the SQL must exist). Matching wants ad-name convention first, "fuzzy name match as fallback" — but creatives have no name column to fuzz against.
**Decision:** Added `db/007-metrics.sql` (+ Drizzle + migration) with the idempotency key `unique(source_id, external_id, date)`. Matching: full UUID or ≥8-hex-char id-prefix slug in the ad name (SOP), manual link route for stragglers, weekly `unmatched-spend-digest` so unmatched spend never rots silently. "Top quartile" is defined as the best ceil(n/4) eligible creatives (min-spend floor $100 default), ties at the cutoff count.
**Alternatives considered:** fuzzing against creative learnings — matching ad names to prose is noise; a creatives.name column — schema addition the specs didn't ask for, revisit when naming SOP exists.
**Revisit if:** the Meta adapter (v1.5) lands with real ad names — then add a name column + trigram matching, or account settings define per-account KPI/min-spend (today: defaults + env).

## 2026-07-17 — E2E must run against the production build (CSP blocks dev-mode eval)
**Context:** The audit header policy (`script-src 'self' 'unsafe-inline'`, no `unsafe-eval`) kills Next dev-mode hydration (webpack eval sourcemaps), so browser tests against `pnpm dev` silently see a dead page.
**Decision:** Playwright config already builds+starts prod (`pnpm start`); documented here because the failure mode is subtle — controlled inputs accept text at the DOM level but React never registers it. Do not weaken CSP for dev; run e2e against the build.
**Alternatives considered:** conditional CSP in dev — drifts from the audited posture the tests are supposed to exercise.
**Revisit if:** Next ships dev sourcemaps that don't need eval.

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
