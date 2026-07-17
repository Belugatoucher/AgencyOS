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

## 2026-07-16 — Log created
**Context:** Spec pack handoff; drift across Claude Code sessions needs a paper trail.
**Decision:** All `// DECISION:` comments in code must have a matching entry here.
**Alternatives considered:** PR descriptions only — rejected, they don't survive squashes.
**Revisit if:** Never.
