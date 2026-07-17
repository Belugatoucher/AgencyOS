# STATUS — through Week 5: Assets + Review

_Last session: 2026-07-17. Read this first next session (HANDOFF.md rule)._

## Week 4 — Assets (docs/05) — COMPLETE
- **Schema** — assets/collections/collection_assets/asset_usage in Drizzle (migration 0003).
- **Grid browser** — account picker + type/status/search filters, upload→register (shared `lib/upload-client`), inline status, type/mime placeholder thumbnails (real thumbs render from `thumb_key` when the media worker runs).
- **Dedup** — checksum match in the same account returns `duplicateOf` and the UI warns.
- **Assignment** — assigning a draft asset spawns an auto-task (`source=asset`) in the assignee's My Tasks.
- **Collections + Brand Kit + drop-box + share links** — collections with `is_brand_kit`/`is_dropbox`; share links reuse the signed-link service (≥128-bit token, PIN, expiry).
- **Rights expiry** — weekly `cron` job flags assets expiring in 30 days and expired-but-still-approved, notifies internal + Slack.
- **Usage backlinks** — `asset_usage` rows + `GET /api/assets/:id/usage`.

## Week 5 — Review (docs/01) — COMPLETE (MVP; version-compare + drawing capture post-MVP)
- **Items/versions** — items with `client_visible` scoping; a new upload = next version, enqueues a `review-transcode` media job.
- **ffmpeg worker** — poster thumbnail + scrub sprite sheet + HLS ladder (720p/1080p) for video, poster for images; sets `thumb_key`/`sprite_key`/`hls_key` and marks the version ready|failed.
- **Comments** — frame-anchored (`timestamp_ms` from `video.currentTime`), region for stills, one-level threading, resolve, click-to-seek. Change punch-list: `open/accepted/declined/done`, decline requires a reason (posted as a reply). "Changes → Tasks" spawns one task with a checklist item per open change.
- **Approvals** — approve / request-changes; request-changes needs ≥1 change comment; can't approve with open changes unless "approve with exceptions" (logs the count). Fires notification + Slack.
- **Share links + public page** — `POST /api/review/items/:id/share` mints a 14-day link (optional PIN); public `/r/:token` page with PIN gate (5/15min rate limit + lockout + owner notification), guest-name-once, comment + approve. Media served via ≤15-min signed R2 URLs minted per request; revoke expires the link so playback dies (audit item 1).

Shared: `lib/media` (ffmpeg wrappers + jobs), `lib/upload-client` (presigned→R2→register), `components/review-player` (used by internal item page + public page).

## Verified this session (real Postgres + Redis)
- Unit: **36 pass** (access 12, rrule 9, lead-scoring 5, lead-intake 7, ffmpeg 3). E2e: **6 pass** (week-1, magic-link, tasks, leads, assets, review-with-public-share). Route-matrix: **124/124** (+16 asset/review/share cases: client of A gets 404 cross-account; public share is session-agnostic — 200 valid token, 404 bad token).
- Share PIN gate driven by curl: no-pin/wrong-pin → `pin_required`, correct → `ok`; 6 wrong attempts → `locked_out` (429). Guest change-comment via token → 201.
- **Media rail proven end-to-end for wiring:** both `asset-thumbnail` and `review-transcode` jobs execute, pull from the R2 stub, and reach the real ffmpeg invocation, failing loudly into `job_runs`. Real thumbnails/HLS need the full ffmpeg the worker Docker image installs (this env's bundled ffmpeg is encoder-less) + real R2. See decisions log.

## How to run (unchanged, plus)
```bash
pnpm test          # 36 unit (add FFMPEG_PATH=/path/to/full/ffmpeg to exercise encode tests)
pnpm test:matrix   # 124-check route matrix (needs running app + DB)
pnpm build && pnpm test:e2e   # 6 playwright specs (CHROMIUM_PATH=/opt/pw-browsers/chromium here)
pnpm worker        # media (asset-thumbnail, review-transcode), ai (score-lead), cron (recurring/digest/rights-sweep)
```
Media processing needs a full ffmpeg (the worker image apt-installs it) + real R2. Locally, point `R2_ENDPOINT` at MinIO to round-trip real media.

## Next (Week 6 — Notes, docs/03)
- Upload + in-person recorder, **whisper worker** (the `transcribe` queue rail exists; add faster-whisper to the worker image like ffmpeg), diarization, Claude meeting notes, action-items→Tasks bridge (the `tasks.source=meeting` column + the changes→task pattern from Review are the template), auto-linking to leads.

## Carrying forward / needs Ryan
- Media verified for wiring only in this env (no full ffmpeg / no real R2). First real deploy should transcode a test clip and confirm HLS plays.
- R2 bucket needs CORS (PUT from APP_URL, expose ETag) for browser uploads; the media worker needs R2 read+write creds.
- Review drawing-overlay capture and version-compare are post-MVP (schema columns ready).
- Portal (doc 11, wk10) will expose client-facing Review/Assets views; `client_visible`/`client_hidden` honored server-side already.
- Route-matrix still hand-extended per new route (automation still TODO). Now 124 checks.
- Standing deploy needs: SMTP_URL, R2 creds + CORS, AUTH_SECRET, APP_ENCRYPTION_KEY, ANTHROPIC_API_KEY.
