# 21 — Platform: Agency OS + Vanessa

_Written 2026-10-31. This is the boundary both repos build against: `Belugatoucher/agencyos` and `Belugatoucher/vanessa`. If a feature could live in either, this doc decides._

## The two products

**Agency OS is the agency.** It's an agentic operating system for a marketing agency: the "WeChat for a marketing agency." Team, clients and agents work in one app. Every module (Review, Tasks, Leads, Sites, Reports) shows up as a card in a conversation and opens into a full page. Agency OS runs its own agents as workers: scout, grader, designer, outreach, builder, reporter. It runs on a VPS.

**Vanessa is Ryan's VA.** She's a personal operator across everything Ryan touches: VNGRD, the junk removal company and personal life. She runs on the Mac mini. Inside Agency OS she's one more member, working through a scoped API token. Outside it, she handles calendar, Jobber, the Obsidian vault, Telegram, voice and Ryan's own follow-through.

**The test:** if the work would still need doing when Ryan isn't the one doing it (prospecting, building client sites, reporting), it belongs to Agency OS. If it's Ryan's work (his follow-ups, his schedule, his errands, his decisions), it belongs to Vanessa.

```
                 ┌──────────────── VPS ────────────────┐
  clients ──────▶│  Agency OS (app + workers)          │──▶ Cloudflare Pages (client sites, previews)
  team    ──────▶│  threads · modules · Autopilot      │──▶ GHL (sole writer)
                 │  Postgres (truth) · Redis · R2      │
                 └──────────────▲──────────────────────┘
                                │ outbound HTTPS + SSE (Vanessa dials out; nothing dials in)
                 ┌──────────────┴──── Mac mini ────────┐
  Ryan ─Telegram▶│  Vanessa (VA)                       │──▶ Calendar (read), Jobber, Obsidian vault
       ─voice ──▶│  + staging Agency OS (docs/20)      │
                 └─────────────────────────────────────┘
```

## Locked decisions

1. **GHL: Agency OS is the only writer.** Vanessa never calls GHL directly. She asks Agency OS (create contact, move opportunity, send SMS) and Agency OS does it, deduped and logged. Her GHL Private Integration tokens get revoked once her GHL actions run through the API.
2. **Memory: Postgres is the truth for business knowledge.** Client Brains, offers, ICPs, goals and meeting notes live in Agency OS (pgvector). The Obsidian vault is Ryan's personal second brain and Vanessa's working notes. When Vanessa learns a business fact, she writes it to the right Agency OS Brain and keeps at most a link in the vault.
3. **Hosting: nothing client-facing runs from home.** Agency OS production goes on a VPS, as docs/00 always planned. Client sites and preview sites go on Cloudflare Pages. The Mac mini runs Vanessa plus a **staging** Agency OS using `docker-compose.local.yml` (docs/20). Vanessa's Servers page manages staging only.

## Who owns what

| Capability | Owner | Notes |
|---|---|---|
| Conversations | Agency OS | Threads per account, DMs, team rooms (see below). Slack stays a mirror until threads replace it. |
| Ryan's chat with his VA | Vanessa | Telegram and voice. She can post into Agency OS threads as herself. |
| Tasks | Agency OS | One task list. Vanessa's inferred follow-ups write via API (`source = 'vanessa'`). Personal tasks go in Ryan's `kind = personal` account (docs/13). |
| Approvals | Agency OS | One queue. Vanessa's own risky actions show up there as `kind = 'vanessa_action'`; she waits for the decision over SSE. Telegram approve and deny buttons call the same endpoint. |
| Meeting notes / transcripts | Agency OS | Notes module (docs/03). Vanessa drops Zoom transcripts in through the Notes ingest API instead of keeping her own pipeline. She keeps local STT only for talking to her. |
| Ideation | Agency OS | Vanessa forwards voice rambles to `/api/ideation`. |
| GHL | Agency OS | Decision 1. |
| Cold outreach (email) | Agency OS | Autopilot (below). Vanessa's cold-email code retires. |
| Warm follow-ups from Ryan's inbox | Vanessa | Drafts in Ryan's voice, approval-gated. |
| Jobber (junk removal ops) | Vanessa | Scheduling and jobs are VA work. The company's marketing is an Agency OS account like any client. |
| Calendar | Vanessa (read) | Agency OS keeps its own Google Calendar link for presales (docs/17). |
| Docker / servers | Vanessa | Staging on the mini. Production deploys run from GitHub Actions to the VPS; Vanessa can trigger a deploy and watch it. |
| Skill scouting | Vanessa | She checks new skills against both module catalogs. Site skill packs live in this repo (docs/18). |

## Autopilot — the automated web design agency

The website and SEO offer (`docs/offers/web-seo.md`) as a daily loop. It's built from parts that already exist: the grader, Sites, Leads, `cron` and `ai` queues and `job_runs`. Times are America/Chicago.

| Time | Stage | What happens | Starting autonomy |
|---|---|---|---|
| 06:00 | **Scout** | For each target in `autopilot_targets` (niche × area, e.g. "junk removal · Rutherford County"), pull businesses from Google Places / DataForSEO. Drop existing clients, open leads and anyone on the do-not-contact list. | Auto |
| 06:30 | **Grade** | Run the grader on every new business. Store the score and the Maps grid. | Auto |
| 07:00 | **Rank** | Score each prospect on opportunity: a low grade, a real business (reviews, phone, hours), a Maps rank gap against the #1 competitor, and the niche's value. Keep the top N per day (config, start at 10). | Auto |
| 07:15 | **Design** | Build a one-page preview from the Google listing, then deploy it to a preview subdomain on Cloudflare Pages. This is the open "prospect preview site" item in docs/18. | Auto |
| 07:45 | **Outreach** | Draft a personal email with the grade report link and the preview link. | **Approve first** |
| 08:00 | **Brief** | Vanessa sends Ryan the morning brief: N prospects, M drafts waiting, replies overnight. | Auto |
| — | **Replies** | Classify replies. Interested → GHL opportunity + booking link + notify Ryan in the thread. Unsubscribe → do-not-contact everywhere. | Approve first |
| — | **Close → build** | A signed deal creates a site in Sites (intake → design → build → live), then the monthly re-grade report. | Existing gates (docs/18) |

**Autonomy levels** are set per stage in `autopilot_settings`: `manual` → `approve` (drafts wait in the queue) → `sample` (auto, with 1 in 10 held for review) → `auto`. A stage moves up a level only on evidence: 4 straight weeks with bounce rate under 3%, spam complaints under 0.1%, and no bad replies. One **kill switch** pauses every outbound stage.

**Spend caps** are daily limits on DataForSEO calls, Claude tokens and sends. Hitting a cap pauses that stage and notifies, the same pattern as the grader's daily spend cap.

**Guardrails (not optional):**
- Cold email only sends from warmed secondary domains (Instantly or similar), never from vngrd.media.
- Every email carries a real postal address, a working unsubscribe, an honest subject line and Ryan's name (CAN-SPAM).
- **No cold SMS and no automated cold calls.** Texting someone who never opted in creates TCPA exposure. SMS is only for people who contacted us first.
- Opt-outs apply to every channel and every future target.

## "WeChat for an agency" — the interface direction

Messaging becomes the home screen, and the modules move into it:

- **Threads:** one or more per account, plus DMs and team rooms. Client contacts see only threads marked `client_visible`, the same rule as everything else in docs/00.
- **Cards:** modules post interactive cards into threads. A review ready to approve, a design proposal with Approve and Reject buttons, a grader report, a task. These are the Slack Block Kit cards from docs/15, built natively.
- **Agents are members.** `@scout`, `@designer`, `@reporter` and `@vanessa` can be mentioned in a thread, and they reply there. Every agent action they take shows up as a card someone can approve or undo.
- **Mini-apps:** every module keeps its full page, opened from the card.

This comes after Autopilot proves the offer. Slack keeps working as a mirror until threads are good enough to drop it.

## The Vanessa ↔ Agency OS contract

- **Auth:** a new `api_tokens` table (hashed token, owner user, scopes, last used, revoked). Vanessa gets one service user (`vanessa@vngrd.media`, role `member`) and one token with explicit scopes. The route-matrix test gains token cases.
- **Scopes for v1:** `tasks:rw`, `notes:ingest`, `approvals:rw`, `threads:post`, `leads:read`, `brain:read`, `brain:write`, `ideation:submit`, `ghl:act` (calls Agency OS's GHL services, never GHL itself).
- **Events:** Vanessa opens an outbound SSE stream (`/api/agent/events`) for approval decisions, new tasks assigned to Ryan, replies and job failures. Nothing on the VPS ever connects into the home network.
- **Vanessa's dashboard shrinks** to System, Servers (staging), Skills, Agents and the vault Brain. Agenda, Approvals, Activity and Outreach become Agency OS pages.

## Build order

0. **Ship what exists.** Merge `claude/grader` (which contains Sites and Ideation) into the main branch. Stand up the VPS and run the grader "Do first" list in STATUS.md. Validate the offer by hand for 30 days (offer playbook, section 9). Autopilot only automates an offer that already closes.
1. **Contract.** `api_tokens`, scopes, the SSE stream. Point Vanessa's task and transcript writes at Agency OS. Retire her SQLite task table.
2. **Autopilot v1.** Scout, grade, rank and preview on auto; outreach and replies on approve-first. `autopilot_targets`, `autopilot_settings`, the kill switch and the caps.
3. **Close the loop.** The remote BuildRunner, the GitHub RepoProvider and the Cloudflare Pages HostProvider (docs/18 checklist), so a signed deal builds without hand work.
4. **Threads and cards.** The WeChat layer. Move Vanessa's remaining pages over.
5. **Raise autonomy** stage by stage as the numbers allow.
