# 06 — Scheduler (Content calendar + posting)

## Purpose

Plan, draft, approve, and publish social content per client from one calendar.

## The key architecture decision

**Publish through GHL's Social Planner API, not direct platform APIs.** You already pay for GHL; each client is (or can be) a sub-account with their Facebook/IG/LinkedIn/TikTok/GBP connections living there. Building direct integrations means Meta app review, token refresh hell, and TikTok's approval process — months of work you don't need. Our Scheduler is the planning/approval brain; GHL is the delivery arm. If you ever leave GHL, only the thin `publish` adapter gets rewritten.

## Objects

```
posts             — account_id, channels[], body, media (asset refs), scheduled_at,
                    status (idea | draft | in_approval | approved | scheduled | published | failed),
                    approval_required bool, ghl_post_id?, published_at?, permalink?
post_approvals    — who approved/rejected, comment
content_slots     — recurring calendar slots per account ("Client X: 3 IG posts/wk, Tue/Thu/Sat")
```

## Flows

**Plan:** calendar view per account (and an all-accounts master view). Empty `content_slots` render as ghost cards — the visual "we owe Client X a Thursday post" nudge.

**Draft:** compose with per-channel body overrides (one idea, tweaked per platform), attach assets from the account's library/Brand Kit, preview per channel. "Draft with AI" runs `prompts/content-repurpose.md` against a source (a meeting transcript, a blog URL, a bullet list) and proposes platform-native variants.

**Approve:** if `approval_required`, the post enters `in_approval`; approvers are internal, or the client via the portal (they see a preview card, tap Approve / Request changes with a comment). No approval → no publish, hard stop.

**Publish:** at `scheduled_at`, the `publish` worker calls GHL Social Planner (create post in the account's sub-account, attach media URLs, set channels). Store `ghl_post_id`. Poll for publish confirmation + permalink; failures flip status to `failed` and page the owner via Slack.

**Report:** pull post metrics from GHL where exposed; the account calendar shows published permalinks inline. Deeper analytics stays in GHL — don't rebuild their reporting.

## Rules

- Media validation before scheduling: per-channel constraints (IG image ratios, video length caps) checked at draft time, not at publish failure time.
- Timezone is per-account; the calendar renders in the client's TZ.
- Deleting a `scheduled` post cancels it in GHL first, then locally.

## Routes

```
GET    /api/posts?account=&from=&to=&status=
POST   /api/posts
PATCH  /api/posts/:id
POST   /api/posts/:id/approval
POST   /api/posts/:id/ai-draft
POST   /api/content-slots
```

## Build checklist

- [x] Schema + calendar UI (month, per-account + master) — week view is post-MVP
- [x] Composer with per-channel overrides + asset picker + validation
- [x] Approval flow incl. client portal card — internal + client-member approve; the portal surface (doc 11, wk10) reuses the same route
- [x] GHL Social Planner adapter + publish worker + failure paging — publish worker + due-post sweep + Slack paging ship now; a pluggable manual-first adapter publishes today, the GHL adapter is behind PUBLISH_MODE=ghl + creds (deferred)
- [x] Content slots + ghost cards
- [x] AI drafting
