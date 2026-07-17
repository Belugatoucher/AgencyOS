# 16 — Academy (Training, SOPs, Internal Notebook)

## Purpose

Three connected pieces: an **SOP library** (the written truth of how the agency works), an **Academy** (courses built from videos + SOPs, assigned by role, tracked to completion), and the **Notebook** (ask-anything AI over all internal knowledge). Replaces Trainual/Notion-wiki/NotebookLM.

## Reuse map (why this module is cheap)

- Training video upload → existing R2 presigned + ffmpeg HLS pipeline (Review's worker).
- Every lesson video auto-transcribes → existing whisper worker. Transcripts make lessons searchable, chaptered, and feed the Notebook.
- Notebook retrieval → existing embedding worker + pgvector, new internal scope.
- Assignments/completions surface in My Tasks + Slack digests — no new notification machinery.

---

## SOP Library

```
sops — title, category, body (markdown), owner_id, status (draft|published|needs_review),
       review_every_days, last_reviewed_at, embedding-chunked on publish
```

- Categories: fixed top level (Client Management · Creative · Media Buying · Sales · Ops · Tools), free tags below.
- Versioned like the Brain (snapshot on publish). Diffs visible.
- **Staleness engine:** each SOP has a review interval; overdue ones flag `needs_review`, ping the owner, and show a stale badge wherever referenced — an SOP library that admits what it doesn't know stays trusted.
- Deep-linkable sections (heading anchors) so lessons, tasks, and Notebook citations point at the exact step.
- "Promote to SOP": meeting notes or a task description can be sent to a draft SOP pre-filled — process capture at the moment it exists.

---

## Academy

### Structure

```
courses    — title, description, audience_roles[], required bool, order
lessons    — course_id, position, title, kind (video|sop|doc|quiz),
             video file_id? (→ HLS + transcript), sop_id?, body?,
             est_minutes, quiz jsonb?
assignments— rule-based: {roles?, user_ids?, course_id, due_days_after_assign}
progress   — user_id, lesson_id, status (todo|in_progress|done), score?, completed_at
```

### Role-based assignment

Assignment rules fire on: new user created with role X, user gains a team tag, or manual assign. New editor joins → "Agency Onboarding" + "Creative Track" auto-assigned, due in 14 days, appears in My Tasks and the Slack morning DM. Managers see a completion matrix (people × courses).

### Lesson experience

Video player with transcript rail (same synced component as Notes), auto-chapters from transcript topic shifts, linked SOPs beneath ("this lesson implements SOP: Client Kickoff"). `kind=sop` lessons render the SOP itself with a "mark understood" gate — write once, teach from the same source, never let docs and training drift.

### Quizzes (optional per lesson)

3–7 questions, pass threshold, attempts logged. AI-drafted from the transcript + linked SOPs via `prompts/course-builder.md`; a human edits before publish. Failing suggests the chapter to rewatch (timestamp from the question's `evidence_ms`).

### Starter curriculum framework (seed content)

1. **Agency Onboarding** (all roles, required): who we are, how we run (this platform), communication norms, security basics.
2. **Client Management Track** (AM/PM): kickoff → weekly cadence → handling escalations → renewal conversations. Each lesson pairs with its SOP.
3. **Creative Track** (editors/designers): brand-kit discipline, review etiquette (answering punch lists), winning-creative patterns (pulls live examples from Intelligence).
4. **Media Buying Track**: naming conventions (the metrics matcher depends on it — make it a quiz), launch checklist, kill criteria.
5. **Sales Track**: pipeline hygiene, using lead scoring + Ask the Brain on calls, proposal flow.
6. **Tools 101** (all): GHL, Slack commands, this platform module-by-module — record these as you build; the walkthroughs from each module's definition-of-done become the lessons.

---

## Notebook (internal NotebookLM)

"Ask the Handbook" — a chat over **internal** knowledge only: SOPs, lesson transcripts, published courses, ops docs. Same tool-use pattern as Ask the Brain but scoped to `kb` chunks; answers cite SOP sections and lesson timestamps (tap → jump to the moment in the video). Slack: `/handbook [question]` works anywhere internal.

Boundary rule: the Notebook never retrieves client data, and Ask the Brain never retrieves the handbook — two scopes, no bleed. A member asking "how do we run kickoffs" gets SOPs; asking in a client channel gets that client's Brain.

Weekly gap report: questions the Notebook couldn't answer well become an "SOPs we're missing" list — the library grows toward what people ask.

## Build checklist

- [x] SOP CRUD + versioning + staleness engine + chunk-on-publish — publish snapshots to sop_versions, daily 06:00 sweep flags needs_review + pings the owner, heading-anchored chunks land in kb_chunks; "promote to SOP" from meeting notes or a task ships too; section-diff view deferred
- [x] Courses/lessons + video pipeline reuse + transcript rail + chapters — lesson-media (HLS) → transcribe-lesson (whisper) → embed-lesson (timestamped kb chunks) all on the existing rails; transcript-rail player UI + auto-chapters render pass deferred (chapters field + AI chapter draft exist)
- [x] Assignment rules + progress + completion matrix + My Tasks/Slack surfacing — rules fire on invite and immediately for current role holders, spawn idempotent My-Tasks tasks (due-date rides the existing daily digest), admin matrix people × published courses
- [x] Quiz builder + AI draft + attempt tracking — Zod-gated quiz shape, server-side grading with attempts + failed-question rewatch evidence (evidence_ms / evidence_anchor); AI draft via prompts/course-builder.md verbatim
- [x] Notebook chat (kb scope) + citations-to-timestamp + /handbook + gap report — read-only kb-only tool loop (scope wall to client data is structural, both directions), citations `sop:<id>#<anchor>` / `lesson:<id>@<ms>`, thin/none answers → notebook_gaps, weekly Wed gap report to Slack; /handbook via /api/slack/commands (v0 HMAC, 501 until the doc-15 Slack app is configured)

Starter curriculum (the six seed tracks) is content work — record as you operate; the "Tools 101" lessons come from each module's definition-of-done walkthroughs.
