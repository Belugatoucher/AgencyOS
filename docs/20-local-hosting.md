# 20 — Local-Only Hosting

Run the entire platform on one machine (or one LAN box) with **zero cloud
dependencies**. Added on request alongside the password-login work — the app
was already local-friendly by design (self-hosted Postgres/Redis, S3-compatible
storage, local whisper/embeddings); this profile just removes the last cloud
assumptions.

## What replaces what

| Cloud piece            | Local replacement                                        |
|------------------------|----------------------------------------------------------|
| Cloudflare R2          | MinIO container (`R2_ENDPOINT` — client already path-style) |
| SMTP provider          | Dev-mailbox file, or any LAN mail relay via `SMTP_URL`   |
| Magic-link dependence  | Password sign-in (set in portal Settings after first login) |
| Caddy + public TLS     | None — app binds `127.0.0.1:3000` (LAN: change the bind) |
| Anthropic API          | Optional. AI jobs fail loudly into /admin/health; all CRUD, review, scheduling, metrics, SOPs, courses work |
| bge-small download     | Ships in the worker image (`EMBED_MODE=local`); `hash` mode needs nothing |

## Quick start

```bash
cp .env.local-hosting.example .env.local-hosting
# fill POSTGRES_PASSWORD / REDIS_PASSWORD / MINIO_ROOT_PASSWORD / AUTH_SECRET / APP_ENCRYPTION_KEY

docker compose -f docker-compose.local.yml --env-file .env.local-hosting up -d --build
docker compose -f docker-compose.local.yml exec app pnpm db:migrate
docker compose -f docker-compose.local.yml exec app pnpm db:seed   # first run only
```

Open http://localhost:3000 — sign in with the seeded admin email; the magic
link lands in the app container's dev mailbox:

```bash
docker compose -f docker-compose.local.yml exec app cat .dev-mail/last-link.txt
```

Then set a password (portal → Settings, or POST /api/auth/password) and the
mailbox is never needed again.

## LAN access

Change the app port binding in `docker-compose.local.yml` from
`127.0.0.1:3000:3000` to `3000:3000`, set `APP_URL=http://<lan-ip>:3000`, and
firewall the box to your LAN. TLS on a LAN: put Caddy back in front with its
internal CA (`tls internal`) — the prod `Caddyfile` works with one line changed.

## What still needs the internet (all optional)

- `ANTHROPIC_API_KEY` — every AI feature (scoring, notes, drafting, Brain,
  Notebook answers). Retrieval/search stays local either way.
- `HF_TOKEN` — first download of the pyannote diarization model.
- GHL / Slack / Canva / Google integrations — leave unset; the app treats them
  as not configured.

## Backups, locally

`scripts/backup.sh` works unchanged — skip the R2 upload vars and it writes to
`/var/backups/agencyos` (mount a volume or point it at a NAS path). Run
`scripts/restore-check.sh` monthly per docs/98.
