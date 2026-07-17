# 04 — Tasks

## Purpose

Assign work, see who's overloaded, and keep every task attached to the account and project it serves. Deliberately smaller than ClickUp: statuses, assignees, due dates, checklists, comments. No custom fields sprawl, no seventeen views.

## Objects

```
tasks             — title, description (markdown), status, priority, assignee_id,
                    account_id?, project_id?, due_at, estimate_minutes?,
                    source (manual | meeting | review | recurring), source_id
task_checklist    — sub-items with done flags
task_comments     — threaded once, @mentions notify
recurring_rules   — RRULE + template → spawns tasks (report every 1st, weekly client call prep)
```

Statuses (fixed): `backlog → todo → in_progress → in_review → done`. Priorities: `low | normal | high | urgent`.

## Views

- **My Tasks** — the default landing page for members: overdue, today, this week.
- **Board** per project.
- **Workload** — tasks per member per week, colored by estimate sum; the "who can take this" view.
- **Account view** — everything open for a client, which doubles as your status-call agenda.

## Integrations inside the platform

- Meeting action items create tasks with `source=meeting` and a backlink to the transcript line.
- "Changes requested" on a Review version offers to spawn a task pre-linked to the version.
- Scheduler can require a linked task to hit `done` before a post goes out (approval gate).

## Rules

- Tasks assigned to you notify on assign, on due-day morning, and on overdue (daily Slack digest, not per-task spam).
- `client` role sees only tasks flagged `client_visible` (used sparingly — e.g. "send us your logo files").
- Completing a task with an open checklist warns but allows.

## Routes

```
GET    /api/tasks?assignee=&account=&project=&status=&due=
POST   /api/tasks
PATCH  /api/tasks/:id
POST   /api/tasks/:id/comments
POST   /api/recurring-rules
```

## Build checklist

- [ ] Schema + CRUD + My Tasks view
- [ ] Project board (drag between statuses)
- [ ] Comments + mentions + notification digests
- [ ] Recurring rules cron
- [ ] Workload view
