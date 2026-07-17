# 02 — Leads (Manual-first pipelines, GHL as optional connector)

## Purpose

Card-based sales pipelines that work with zero integrations on day one. Every account gets its own pipeline(s): the agency's internal account tracks *your* prospects; client accounts track leads you generate *for them*, optionally surfaced in their portal. GHL sync is a per-account mode you flip on later — same dashboard either way.

## Source modes (per account)

```
accounts.lead_mode — 'manual' (default) | 'ghl'
```

- **manual:** full CRUD in the dashboard. Leads arrive by hand, CSV import, or a public intake endpoint (a simple form URL per pipeline you can wire to any website form/Zapier — cheap lead capture without GHL).
- **ghl:** activates the sync engine (see appendix) once a `ghl_location_id` is connected. Cards look and behave identically; sync just moves data underneath. Switching manual → ghl runs a one-time match/merge (email/phone) with a review screen.

The mode is invisible to the UI layer — one dashboard component, two data sources.

## Pipelines & stages (now local, per account)

```
pipelines — account_id, name, position
stages    — pipeline_id, name, color, position, is_won bool, is_lost bool
leads     — account_id, pipeline_id, stage_id, + fields below
```

Defaults seeded per account (editable): `New → Contacted → Qualified → Proposal → Won / Lost`. Stages are drag-reorderable; deleting a stage requires moving its leads. In ghl mode, pipelines/stages mirror GHL's and lock local editing.

## The lead card

One card = one lead, same anatomy everywhere (agency dashboard, client dashboards, portal):

**Face (kanban):** name + company, value, owner avatar, days-in-stage, next-action date (red when overdue), source chip, score if set.

**Expanded (drawer):** contact fields (name, email, phone, company, links), value, source, tags · **timeline** (notes, stage changes, calls with dispositions, synced events in ghl mode) · linked meetings with summaries · linked tasks · documents (deck, proposal — doc 17) · next action (date + note — the field the whole system nags about) · AI score + rationale on demand.

Every field edits inline on the card; stage changes by drag or dropdown; all edits hit the same service so manual and ghl modes share one code path (ghl mode additionally enqueues the push for shared fields).

## Views

- **Kanban** per pipeline (the default), **table** with saved filters, **all-accounts overview** for you: every pipeline's totals, stalest leads, and value at a glance — the "how's lead-gen going across all clients" screen.
- Metrics strip per pipeline: value by stage, win rate, new this week, avg days-to-close, no-next-action count.

## Client portal: Leads page (optional, per account)

Toggle `portal_leads: off | summary | full` on the account:

- **summary:** stage counts + value totals + wins this month. Proof of work without exposing every record.
- **full:** the same kanban, read-only, minus internal-only fields (owner notes, score rationale, internal tasks). Clients can comment on a card (lands in the timeline, notifies the owner) but never edit or move. Leads flagged `client_hidden` don't render at all.

This is the retention play: a client watching their pipeline fill in real time inside *your* branded portal doesn't shop around.

## Build checklist

- [x] Pipelines/stages CRUD + seeded defaults + card component
- [x] Lead CRUD, inline editing, drag kanban, table + filters, drawer with timeline
- [x] CSV import + public intake endpoint per pipeline
- [x] All-accounts overview + metrics strip + no-next-action nagging
- [ ] Portal leads page (summary/full modes) — deferred to Week 10 (portal, doc 11)
- [x] AI scoring (unchanged from before)
- [ ] GHL connector (appendix) — build only when you actually have GHL

## Appendix: GHL sync engine (deferred, unchanged design)

The original two-way design still holds when `lead_mode='ghl'`: GHL owns contact/opportunity shared fields, we own internal workflow fields; webhooks in with echo suppression via payload hashing; debounced pushes out; GHL wins conflicts with a logged `conflict` activity; nightly reconciliation; first-connect backfill with match/merge review. `sync_map`, `sync_log`, and `/ghl/health` as previously specified. Nothing about the card UI changes — that's the point.
