# 13 — Personal Calendars & Extras

## Personal content calendars (the elegant solve)

No new module. `accounts` gains a `kind` column: `client | internal | personal`. Each team member who wants one gets a **personal workspace** — an account of kind `personal` owned by them. Everything already built now works for personal brands for free:

- Own **content calendar** in Scheduler (posts publish via a GHL sub-account or stay as a planned calendar with manual posting if their personal socials aren't in GHL).
- Own **Client Brain** ("my voice, my niche, my content pillars") powering Ask the Brain for personal content.
- Own hooks scope, drafts, review items (get teammate feedback on your video before posting), assets.

Rules: personal workspaces are private to their owner + admins by default; they're excluded from client-facing surfaces, metrics rollups, and reports; `kind='internal'` covers the agency's own marketing (the agency is just another client — dogfood everything).

**Master calendar:** one view merging all calendars the viewer can see — client posts (colored per account), personal posts, meetings, task due dates, and content-slot ghosts. Filters by account/type/member. This becomes the default home screen for the team. Read-only aggregation over existing tables; zero new writes.

## Useful (recommend building)

- **Client health score** — composite per account: approval turnaround trend, meeting `sentiment` (Notes already extracts it), retainer burn vs. pace, overdue-to-them items, days since last win. Red/yellow/green on the account header. Churn rarely surprises the data; this makes it un-ignorable.
- **Idea inbox** — quick-capture everywhere (PWA share target, a `/idea` box, voice memo → whisper → text). Ideas land as cards, taggable to an account, one tap to promote into a draft post, task, or hook. The gap between "thought of it in the shower" and "it's in the system" goes to zero.
- **Best-time-to-post** — once metrics accumulate, suggest slot times per account/channel from actual engagement. Cheap heuristic first (top historical windows), no ML.
- **Weekly AI content ideas** — Monday job per active account: Brain + recent VoC + content gaps → 5 idea cards into the Idea inbox, pre-tagged. A human promotes or deletes; nothing auto-drafts.
- **"On deck" daily view** — each member's morning screen: today's meetings (with prep links), due tasks, reviews waiting on them, posts publishing today. Pairs with the Slack digest.

## Fun (cheap morale, ship in gaps)

- **Win wall** — auto-feed to a Slack channel + a portal-free internal page: version approved 🎉, lead moved to won, creative crossed the winning threshold, streak milestones. Confetti on the in-app event. Silly; works.
- **Streaks** — per-account content consistency (no missed slots) and personal posting streaks. Break a client streak and the ghost card turns judgmental.
- **Ship log** — auto-generated "this week we shipped" timeline from approvals + published posts + done tasks; scrubbing through a quarter feels great and doubles as retro material.
- **On this day** — surfaced card: the hook you saved a year ago, the creative that won last quarter. Keeps the library alive instead of write-only.

## Schema delta

```sql
alter table accounts add column kind text not null default 'client';  -- client|internal|personal
alter table accounts add column owner_user_id uuid references users(id); -- personal workspaces
create table ideas (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references accounts(id),
  user_id uuid not null references users(id),
  body text not null,
  source text not null default 'manual',    -- manual|share|voice|ai_weekly
  status text not null default 'inbox',     -- inbox|promoted|archived
  promoted_to text, promoted_id uuid,
  created_at timestamptz not null default now()
);
```

## Build placement

Personal workspaces + master calendar: fold into Scheduler week (7). Idea inbox: week 8 alongside Intelligence capture (shares the PWA share target). Health score + weekly ideas: v1.5 with Reports. Fun items: whenever someone needs a Friday afternoon win.
