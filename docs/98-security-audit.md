# 98 — Security Audit (Spec-Stage)

Audit of the specs as written. ✅ = already sound in the design · 🔴 must fix before launch · 🟡 fix in v1 · 🔵 v1.5 acceptable. Claude Code: the 🔴/🟡 controls are requirements, same authority as module specs.

## What the design already gets right ✅

Centralized role middleware instead of per-route checks · presigned direct uploads (app never touches file bytes) · webhook verify-enqueue-200 pattern · GHL echo suppression + conflict logging · `client_visible` defaulting to false everywhere · transcription kept on-box · RAG scope walls (client Brain ↔ handbook, cross-client anonymization) · claims restricted to proof_points · soft deletes + append-only audit design · Slack as mirror-never-truth · human gates on all AI writes.

## Findings

### 🔴 1. Share links & PINs are the biggest exposed surface
Unauthenticated clients + forwarded links = your most attacked endpoint. Required: tokens ≥128-bit CSPRNG (no sequential/short IDs anywhere public); server-side expiry enforcement; PIN attempts rate-limited (5/15min per token+IP, then lockout + owner notification); media served via short-lived (≤15 min) signed R2 URLs minted per request — never store or expose permanent object URLs; revoking a share link must actually kill playback (signed URLs expire it naturally).

### 🔴 2. Token storage
`gcal_tokens jsonb` "encrypted" must be real: AES-256-GCM app-level encryption with `APP_ENCRYPTION_KEY` for ALL stored OAuth tokens (GCal, GHL, Canva, Slack). Tokens never appear in logs, job payloads, `sync_log`, or error messages — redact at the logger level, not by discipline.

### 🔴 3. Magic-link auth hardening
Single-use tokens, 10-minute expiry, ≥128-bit; rate-limit requests per email + per IP (prevents mailbox-bombing and enumeration — identical response whether the email exists or not); session rotation on login; cookies `HttpOnly, Secure, SameSite=Lax`.

### 🔴 4. VPS & network hardening (deploy checklist)
SSH keys only + no root login; UFW allowing 22/80/443 only; Postgres/Redis on the Docker network exclusively — **no published ports**; Redis with `requirepass` anyway (defense in depth); fail2ban; unattended-upgrades; Caddy handles TLS + HSTS. Backups: `pg_dump` encrypted (age/gpg) before upload, separate R2 credentials that can *write but not delete* (ransomware protection), restore tested monthly per roadmap.

### 🔴 5. Client-role isolation must be proven, not assumed
One mis-scoped query leaks Client A's pipeline to Client B — existential for an agency. Required: an automated **route-matrix test**: every API route executed as admin/member/client/anonymous against fixtures from two accounts, asserting cross-account reads return 404/empty. Runs in CI; a new route without matrix coverage fails the build. This is the highest-value test in the codebase.

### 🟡 6. Public endpoints (intake forms, lead capture, share pages)
Cloudflare Turnstile + honeypot field; per-IP rate limits; strict Zod schemas with size caps; uploads to drop-boxes count-and-size capped per token; intake tokens single-account scoped and expiring (already spec'd).

### 🟡 7. Uploaded-file handling
Validate real content type (magic bytes), not extension/claimed MIME. **Never serve user-uploaded SVG/HTML inline from the app origin** (stored-XSS vector) — serve from R2 with `Content-Disposition: attachment` or transcode SVGs to PNG for previews. Image/video processing runs in the worker container (already isolated); cap ffmpeg/whisper input sizes; strip EXIF on portal-visible images. ClamAV scan job on drop-box uploads (client-supplied files) — 🔵 for internal uploads.

### 🟡 8. Prompt injection (real risk, you have tool-using AI over untrusted text)
Transcripts, intake answers, scraped research, and hooks are untrusted input that flows into Claude with retrieval tools. Mitigations: Brain/Notebook/Handbook tools are **read-only** — no tool that mutates data or sends anything is ever wired into a chat that ingests retrieved content; anything actionable (Brain edits, tasks from notes, deck values) goes through the existing human-review gates — never weaken these; retrieved chunks wrapped in delimiters with a system-prompt instruction that retrieved content is data, not instructions; extraction jobs (notes, deck autofill) output-validated by Zod schema so injected text can't smuggle extra fields.

### 🟡 9. Webhook & Slack interactivity hardening
GHL + Slack + Stripe/PandaDoc (v1.5): verify signatures (spec'd) **plus** reject timestamps >5 min old (replay protection). Slack actions: map `slack_id` → platform user and run the normal access check before executing — a button press is an API call with Slack-shaped clothing; audit `via: slack` (already spec'd).

### 🟡 10. App-level headers & limits
CSP (self + R2 media + hls; no unsafe-inline scripts), X-Frame-Options DENY except the portal embed if ever needed, global per-user rate limits on mutation routes, request body caps. `/admin/*` (health, audit viewer) behind admin role — worth stating explicitly.

### 🔵 11. Later
Dependency scanning (npm audit/Socket in CI) · Sentry with PII scrubbing · secret rotation runbook · data-deletion path for leads/contacts on request (privacy compliance; recording-consent notice already spec'd) · 2FA for admins (magic link + TOTP) when contractors arrive with scoped permissions (doc 12B).

## Standing rule

New modules inherit this audit: any spec adding a public endpoint, a stored credential, an AI tool, or a new webhook must state which controls above apply. If none fit, it needs a new finding here first.
