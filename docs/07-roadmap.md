# 07 — Build Order & Suggested Features

## Why this order

Ship the shared core first, then the module with the fastest payoff per unit of build (Tasks), then the revenue-facing ones. Review's media pipeline is the heaviest lift; it lands once the file service already exists from Assets.

## 8-week plan (solo dev pace with Claude Code; halve it with two)

**Week 1 — Core.** Repo, Docker Compose, schema migration, Auth.js magic links, spine CRUD (accounts/projects/users/memberships), role middleware, notifications table + Slack dispatcher, presigned upload service.

**Week 2 — Tasks.** Full module. The team starts living in the tool immediately, which forces the core to harden.

**Week 3 — Leads (manual-first).** Pipelines/stages CRUD, lead cards + kanban/table/drawer, CSV import + public intake endpoint, all-accounts overview, AI scoring. GHL connector deferred to when GHL exists (doc 02 appendix).

**Week 4 — Assets.** Grid, collections, Brand Kit, share links, thumbnails (this builds the media worker Review needs).

**Week 5 — Review.** HLS transcode, player + timestamped comments, share links + PIN, approvals. Drawing overlay if time allows, else week 8.

**Week 6 — Notes.** Upload + in-person recorder, whisper worker, diarization, Claude notes, action-items→Tasks bridge, auto-linking to leads.

**Week 7 — Scheduler.** Calendar, composer, GHL Social Planner adapter, approvals, content slots.

**Weeks 8–9 — Intelligence + Metrics.** pgvector + embedding worker, hooks DB with PWA share-target capture, research pipeline, Client Brain editor, Ask the Brain chat with retrieval + citations. CSV metrics importer + rollups + is_winning compute (doc 09) closes the loop. Composer integration last.

**Week 10 — Onboarding + Client portal + polish.** Intake wizard → Brain v1 (doc 10). Portal (doc 11). Client dashboard stitching Review items, shared collections, post approvals, visible tasks. Search-everywhere bar. Job health panel. Backups verified by restoring one.

**Weeks 11–12 — Academy.** SOP library + staleness engine, courses/lessons reusing the media + whisper pipelines, role-based assignments + completion matrix, quizzes, Notebook chat on the kb scope (doc 16). Record Tools 101 lessons as you build — each module's definition-of-done walkthrough becomes its lesson.

## The scope-creep rule

New modules must ride the existing rails: spine (accounts/users/roles), files + media workers, whisper, jobs queue, RAG layer, notifications/Slack, theming tokens. Reuses rails → cheap, say yes. Needs a new rail → own doc, hard look first. Academy proved the pattern: an LMS + wiki + NotebookLM cost five tables and one prompt because every heavy piece already existed.

## Suggested features (you asked)

**Include in v1 — cheap and high-leverage:**
- **Client portal** (above) — one link per client for everything you owe them and everything you need from them. This alone reads as a premium agency experience.
- **Universal search** (cmd-K) across leads, tasks, assets, meetings, posts.
- **Daily Slack digest** per member: due today, overdue, awaiting-your-approval.
- **The shame lists:** leads with no next action, assets expiring, posts missing for a content slot, reviews awaiting client >3 days (auto-nudge email to the client).

**v1.5:**
- **Time tracking lite** — a timer on tasks, weekly per-account rollup. Feeds retainer math.
- **Retainer meter** — hours or deliverables burned vs. contracted per account per month, visible red/yellow/green. Agencies bleed on untracked scope; this is the fix.
- **Meeting-to-pipeline hooks** — when Notes detects "send proposal" in action items on a lead-linked meeting, prompt to move the GHL stage.

**v2:**
- **Reports generator** — monthly client report assembled from Scheduler metrics + tasks shipped + review approvals, rendered to a branded PDF (there's a marketing performance-report skill pattern to borrow).
- **SOP/wiki** — markdown pages per account and per process, linkable from tasks.
- **Meeting bot** for auto-joining Zoom/Meet (buy: recall.ai; build: Puppeteer bot container). Only worth it if manual upload friction proves real.
- **Invoicing hooks** — push retainer/overage lines to Stripe or your accounting tool.

**Don't build:** email sending (GHL does it), SMS (GHL), landing pages (GHL), deep social analytics (GHL), chat (you have Slack). Every one of these is a swamp.

## Definition of done, per module

Schema migrated · routes tested with Zod-validated fixtures · role checks verified for `client` role · jobs have retry + surface in health panel · one Loom-style walkthrough recorded for the team.
