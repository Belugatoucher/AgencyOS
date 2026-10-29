# 19 — Ideation (Ramble → Goals & Action Items)

## Purpose

Talk or type freely about a business, the way you'd think out loud in the truck. Agency OS turns the ramble into:

- **Action items**: concrete next steps, each scored for impact and effort, with a suggested due date and the line you said that produced it.
- **Goal proposals**: new outcomes worth tracking, written as measurable goals.
- **Ideas to park**: good thoughts that aren't for now.
- **Open questions**: things you need to find out before deciding.
- **Strategy flags**: anything that pulls *away* from the active goals, said plainly.

Every item is judged against the business's **active goals** (and its Brain, if it has one: offer, ICP, positioning, quarter goals), so the output is ranked by what moves the business forward, not by how excited you sounded.

Nothing lands anywhere until you accept it: accepting an action creates a real task (in My Tasks, with the due date); accepting a goal adds it to the goal list; ideas and questions park on the session.

## Reuse map

- Voice: the same MediaRecorder → presigned R2 upload → faster-whisper pipeline as the in-person recorder (docs/03). Audio stays on our infra; only text goes to Claude.
- Tasks: accepted actions are ordinary `tasks` rows (`source = 'ideation'`, `source_id` = the item), so the daily digest, Slack nudges and due-date views all pick them up for free.
- Brain: the account's `client_brains` row is read as context. The agency's own internal account is where VNGRD's own goals live (same convention as the agency's prospect pipeline, docs/02).

## Model

```
goals          — account_id, title, detail, horizon (quarter|year|long_term), metric, target,
                 due_on, status (active|achieved|dropped), position, deleted_at
idea_sessions  — account_id, title, source (text|voice), audio_file_id, transcript,
                 status (transcribing|thinking|ready|failed), summary, themes jsonb, error, deleted_at
idea_items     — session_id, account_id, kind (action|goal|idea|question|risk), title, detail,
                 goal_id (the goal it serves), alignment (advances|new_direction|off_strategy),
                 alignment_note, impact 1-5, effort 1-5, horizon (now|this_week|this_month|this_quarter|later),
                 suggested_due, quote, status (proposed|accepted|dismissed|parked), task_id, created_goal_id
```

## Flow

1. **Ramble** — type/paste, or record (phone or laptop). Pick the business (defaults to the agency).
2. Voice: `transcribe-idea` job (transcribe queue) → transcript text.
3. `ideation` job (ai queue): `prompts/ideation.md` + active goals + Brain + today's date → JSON, parsed with one retry (rule 6) → items.
4. **Review** — items grouped as *Do next* (actions, ranked by alignment × impact ÷ effort), *New goals*, *Park*, *Questions*, *Strategy flags*. Accept / dismiss each, or accept all actions at once.
5. Accepted action → task (due = suggested due, assignee = you). Accepted goal → `goals`.

## Access

Internal-only (admin/member). Clients never see goals, rambles or items. All routes return 404 to clients.

## Build checklist

- [x] Spec, schema (db/011), Drizzle tables
- [x] Prompt (`prompts/ideation.md`), Zod output contract, ranking (pure, tested)
- [x] Services: goals CRUD, sessions (text + voice), ideation job, item decisions (→ tasks / goals)
- [x] Jobs: `transcribe-idea` (transcribe queue), `ideation` (ai queue)
- [x] Routes + `/ideas` page (business picker, goals panel, ramble box with recorder, session review)
- [ ] Drizzle migration generated + applied
- [ ] Route-matrix run (cases written)
- [ ] Weekly goal review: Monday digest of goals with no accepted actions in 14 days
- [ ] "Ramble from Telegram" via Vanessa once her repo is reachable
- [ ] Playwright smoke: ramble → accept action → task appears in My Tasks
