# 11 — Client Portal (Core, week 10) — RATIFIED

## Purpose

One login (or one magic link) per client showing everything they owe you and everything you owe them. It's a *view* over existing modules — near-zero new backend.

## Pages

- **Home:** action-needed stack — reviews awaiting their approval, posts awaiting approval, tasks flagged for them, files requested. Empty stack = "You're all caught up," which clients screenshot and love.
- **Reviews:** their `client_visible` review items with the full player experience — timestamp-anchored commenting (click to pause + pin, markers on the scrub bar, range comments), drawing overlays, and the change-suggestion flow (numbered punch list, current→proposed text edits, per-change status). Identical components to internal, client-skinned; clients see "What changed in v2" diffs on each new version. Approve / Request Changes lives here, with the same no-vague-feedback gate (requesting changes requires at least one anchored change).
- **Content:** approved + scheduled + published calendar (read-only except approvals), with permalinks once live.
- **Files:** shared collections + their drop-boxes.
- **Documents:** every `client_visible` document — signed proposal, contract, monthly report PDFs, creative briefs, the pitch deck they saw (doc 17). Kind-grouped, newest first. Ends "can you resend the contract" forever.
- **Leads (optional, per account):** their pipeline as summary (stage counts + value + wins) or full read-only kanban with comment-only cards — see doc 02. Off by default.
- **Meetings:** only meetings explicitly flagged `client_visible` (e.g., shared recaps — summary only, never raw transcript).

## Rules

- Change suggestions extend to **post approvals** too: rejecting a scheduled post asks for line-level suggestions on the copy (same `{current, proposed}` shape) instead of a bare rejection comment. Members accept/decline each suggestion in the composer.
- Portal actions notify the account's team channel in Slack within seconds — a client leaving 12 timestamped changes at 9pm is something you want to see at 9:01, not tomorrow.
- Clients can only comment/suggest/approve — never edit, delete, or see internal comments (internal threads on the same version are role-filtered out).

- Everything renders through the existing `client` role checks — the portal adds no new permission logic, it's a filtered UI shell. If a record isn't `client_visible`, the portal cannot render it by construction.
- Branding: agency logo + account name; optional custom domain later (CNAME + Caddy on-demand TLS).
- Weekly digest email per client contact: what shipped, what needs their eyes (settable per account: weekly/off).

## Build checklist

- [x] Portal layout + home action stack — /portal/:accountId shell (Home/Reviews/Content/Files/Meetings); clients land there on login; "You're all caught up" empty state
- [x] Review + approval reuse with client skin — same ReviewItemClient, team controls hidden; internal threads role-filtered (new `internal` flag); portal actions page Slack; "what changed in v2" diffs deferred
- [x] Content calendar read-only view — list view of in_approval/approved/scheduled/published with permalinks; approve or reject-with-{current,proposed}-suggestions (bare rejections refused); composer accept/decline-per-suggestion UI deferred
- [x] Weekly digest job — Fri 08:30 cron, per-account weekly|off, quiet weeks skipped, SMTP with dev-mailbox fallback

Deferred pages: Documents (doc 17 presales module not built yet), Leads summary/kanban (doc 02 portal pass; `portal_leads` setting already in schema), custom domains (doc 14).
