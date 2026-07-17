# 00 — Architecture & Shared Core

## Principle

Every module reads from the same spine: **Account → Project → Person**. A "client" is an Account. A campaign or retainer is a Project under that Account. Team members and client contacts are People with roles. Nothing gets its own parallel client list.

## The spine

```
accounts        — client companies (also where GHL contact/opportunity sync anchors)
projects        — campaigns, retainers, one-off jobs under an account
users           — team members + client contacts (role-gated)
memberships     — user ↔ account, with role (admin | member | client)
```

Rules:

- Internal users (`admin`, `member`) see all accounts.
- `client` users see only accounts they hold a membership on, and inside those, only records flagged `client_visible`.
- Every record in every module carries `account_id`, and `project_id` where it applies. Row-level access checks run in one middleware, not per-module.

## Auth

Auth.js with magic-link email. No passwords to reset, and clients never fail a login. Session cookie, 30-day expiry. Client invites: a member adds a client contact to an account → they receive a magic link → their role is `client` forever unless an admin changes it.

Share links (Review module) work without login: signed URL with an expiry and an optional 4-digit PIN, so a client can forward a review link to their boss without you provisioning anyone.

## Jobs

BullMQ queues on Redis. Workers run in the same Docker Compose file as the app, separate container.

| Queue | Jobs |
|-------|------|
| `media` | ffmpeg transcode to HLS, thumbnail extraction, waveform generation |
| `transcribe` | faster-whisper transcription, speaker diarization |
| `ai` | meeting summaries, action-item extraction, lead scoring, content drafts |
| `ghl` | outbound sync pushes, webhook processing, nightly reconciliation |
| `publish` | scheduled post publishing via GHL Social Planner |

Every job writes to a `job_runs` table (status, error, payload hash) so failures surface in an admin panel instead of vanishing.

## Notifications

One `notifications` table + a dispatcher. Channels: in-app bell, email, and Slack webhook (post to a channel per account or one firehose). Events that notify: task assigned, comment added on your upload, review approved/rejected, lead stage changed, meeting notes ready, post published or failed.

## File storage

All uploads go direct from browser to R2 via presigned PUT. The app never proxies file bytes. Keys are namespaced: `{account_id}/{module}/{uuid}/{filename}`. A `files` table tracks every object: size, mime, checksum, uploader, module, parent record.

## API conventions

- Route handlers under `/app/api/*`, thin — validation (Zod) + service call.
- Services under `/lib/services/*` own business logic. Workers import the same services.
- Mutations return the full updated record; the frontend uses TanStack Query with optimistic updates.
- Webhooks (`/api/webhooks/ghl`) verify signature, enqueue, return 200 in <1s. Processing happens in workers.

## Environment

```
DATABASE_URL, REDIS_URL
R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET, R2_BUCKET
ANTHROPIC_API_KEY
GHL_CLIENT_ID, GHL_CLIENT_SECRET, GHL_WEBHOOK_SECRET
SMTP_URL (magic links + notifications)
SLACK_WEBHOOK_URL (optional)
APP_URL
```

## Docker Compose services

`app` (Next.js), `worker` (BullMQ consumers), `postgres`, `redis`, `caddy`. Whisper runs inside `worker` via faster-whisper (CPU int8 — a 1-hour call transcribes in ~6–8 min on 8 vCPU; upgrade to a GPU box later if volume demands it).
