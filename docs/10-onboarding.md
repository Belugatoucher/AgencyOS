# 10 — Client Onboarding (Core)

## Purpose

A new account goes from signed to fully wired in one guided flow — Client Brain populated, brand kit stocked, GHL mapped, kickoff tasks spawned. Kills the "new client, empty tool" problem that would otherwise make the AI generic for weeks.

## Flow

**Internal setup (5 min):** create account → link `ghl_location_id` from a dropdown of GHL sub-accounts → pick a project template (retainer type) → send intake link.

**Client intake form (shareable link, no login):** sections map 1:1 to Client Brain fields — offer, ICP, goals, voice (with "brands you admire" + sample copy they like), objections they hear, proof points (with upload slots for evidence), compliance/legal no-gos, competitor list. Plus a brand-asset drop-box (logos, fonts, guidelines → straight into a Brand Kit collection) and access checklist (ad accounts, socials — tracked as tasks, not stored credentials).

**Review & commit:** submissions land as a `brain_suggestions` batch; a member reviews each answer, edits, accepts → Client Brain v1 written, competitor list seeds `research_docs` stubs, uploads become assets, gaps become tasks assigned to the AM. Logo uploads trigger a **portal theme proposal** (palette extraction + live portal preview — see doc 14); accepting brands their portal before first login.

**Kickoff automation:** accepting the intake spawns the template's task set (kickoff call, audit, first content batch), a content_slots proposal, and a kickoff meeting record ready for the note taker.

## Objects

```
intake_forms      — account_id, token, sections jsonb, status (sent|in_progress|submitted|committed)
project_templates — name, task_set jsonb, default_slots jsonb
```

## Rules

- Intake link expires in 30 days; partial saves allowed (clients never finish in one sitting).
- Nothing writes to the Brain without member acceptance — same suggestion gate as everywhere else.
- Re-running intake later (annual refresh) diffs against the current Brain instead of overwriting.

## Build checklist

- [x] Intake form builder-lite (fixed sections, per-account toggle) — fixed sections 1:1 with Brain fields; per-account section toggles follow when a client needs them
- [x] Public form page + partial save + drop-box — 30-day CSPRNG token, partial saves merge, audit-item-6 hardening (rate limit, caps, identical 404s); brand-asset drop-box lands with the public-presign uploads pass
- [x] Review/commit screen → Brain v1 + assets + tasks — submission is a pending suggestion (blind accept refused); commit writes Brain v1 via the versioned updater, competitors → research stubs, access gaps → AM tasks
- [x] Project templates + kickoff spawn — task_set (offset_days, client_visible) + default_slots + kickoff meeting record; annual-refresh diff mode deferred
