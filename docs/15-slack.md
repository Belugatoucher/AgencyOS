# 15 — Slack Integration

## Purpose

Upgrade from the v1 webhook firehose to a real Slack app: per-account channels, actionable buttons, slash-command capture, and digests. The team already lives in Slack; the platform should meet them there instead of demanding another tab.

## App setup

One internal Slack app (bot token, `chat:write`, `commands`, `channels:read`, `users:read.email`). OAuth install from Settings → Integrations. Slack user ↔ platform user matched by email once, stored on `users.slack_id`. Events/interactivity endpoint: `/api/webhooks/slack` (signature-verified, enqueue, 200 fast — same pattern as GHL).

## Channel routing

```
slack_routes — account_id? , channel_id, kinds[]   -- which event kinds go where
```

Defaults: `#agencyos-feed` gets everything; per-client channels (e.g. `#client-acme`) get that account's events; `#wins` gets the win wall. Routable kinds: review activity, approvals, lead stage changes, hot leads, notes ready, publish success/fail, portal activity, health score changes, digests. Per-kind mute per channel.

## Interactive messages (the good part)

Events post as Block Kit messages with buttons that act without leaving Slack:

- **Review:** "Acme approved Brand Video v3 🎉" / "Acme left 12 changes" → [Open punch list] [Send to Tasks]
- **Task assigned:** [Mark done] [Snooze to tomorrow] [Open]
- **Internal approval requests:** post preview + [Approve] [Request changes] (changes opens a Slack modal for the comment — the no-vague-feedback gate applies here too)
- **Publish failed:** [Retry] [Open post] — pages the post owner directly
- **Hot lead scored:** [Claim] (sets owner) [Open in dashboard]

Button actions hit the same services as the UI; every action is audited with `via: slack`.

## Slash commands & capture

- `/idea [text]` → Idea inbox (account inferred from channel route, else picker)
- `/task [title] @person [due]` → creates task, replies with link
- `/brain [question]` in a client channel → Ask the Brain answers in-thread (retrieval-cited, compliance rules apply; refuses in channels not routed to an account)
- Message shortcut "Save as hook" → any message/ad-link someone drops in Slack becomes a tagged hook

## Digests

- **Personal DM, 8:30am:** today's meetings, due tasks, reviews waiting on you, posts publishing.
- **Client channel, Friday:** the week's ship log for that account (pairs with 13-extras).
- **Ops channel, daily:** job failures, unmatched ad spend, sync drift, expiring rights — the health panel, pushed.

## Rules

- Slack is a mirror, never the source of truth: no data lives only in Slack; every message links back to the record.
- Client-facing content previews in Slack respect the same claims/compliance discipline (they're internal, but screenshots travel).
- Rate-safety: batch bursts (a client leaving 12 comments = one message that updates, not 12 pings).

## Build checklist

- [ ] Slack app + OAuth + user matching + `/api/webhooks/slack`
- [ ] slack_routes + dispatcher upgrade (webhook → Block Kit via bot token)
- [ ] Interactive buttons for review/tasks/approvals/publish-fail/leads
- [ ] Slash commands + save-as-hook shortcut
- [ ] Digest jobs (personal, client-weekly, ops)
