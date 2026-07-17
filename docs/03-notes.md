# 03 — Notes (Private AI note taker)

## Purpose

Record any meeting — Zoom/Meet, in-person, or an uploaded file — transcribe it on your own server, and turn it into structured notes, action items, and CRM context. Audio never touches a third-party transcription service.

## Capture paths

1. **Upload** — drop any audio/video file onto a meeting record. Ships day one.
2. **In-person** — the app's `/record` page uses MediaRecorder in the mobile browser: tap record, phone on the table, chunks upload every 30s so a dead battery loses nothing. Ships day one.
3. **Zoom/Meet calls** — pragmatic MVP: record locally (Zoom local recording / built-in recorder) and drop the file in — path 1 covers it. Phase 2: a bot participant that joins via meeting URL (recall.ai is the buy option; a self-hosted Puppeteer bot is the build option — spec'd in `07-roadmap.md` as optional).

## Pipeline

```
audio file in R2
  → transcribe queue: faster-whisper (large-v3, int8) → segments with timestamps
  → diarization: pyannote → speaker labels merged into segments
  → ai queue: Claude with prompts/meeting-notes.md
       → summary, decisions, action items (owner + due date guesses), follow-ups
  → auto-link: match attendee emails/names against leads + accounts
  → action items → optional one-tap "create tasks" into Tasks module
  → notify: "Notes ready for [Meeting]" with summary preview
```

Speaker names: diarization outputs SPEAKER_00/01; the UI asks once ("Who is Speaker 1?") and remembers voices are *not* fingerprinted — it's per-meeting labeling, fast and private.

## Objects

```
meetings          — title, occurred_at, account_id?, project_id?, attendees[]
transcripts       — segments jsonb [{start_ms, end_ms, speaker, text}]
meeting_notes     — summary, decisions[], action_items[], followups[], raw AI output
```

## UI

- Meeting page: audio player synced to transcript (click a line → seek), speaker rename, edit notes inline.
- Search across all transcripts (Postgres full-text on segments).
- Lead/account drawers show linked meetings with the summary inline — sales context lives where the deal is.
- Action items panel: checkbox each → creates a Task pre-filled with owner and due date.

## Privacy rules

- Transcription local (faster-whisper on your VPS). Only the *text* transcript goes to the Anthropic API for summarization.
- `client_visible` defaults to **false** on all meetings.
- Retention setting per account: keep audio forever / 90 days / delete after transcription (transcript kept).
- Recording consent is on you: the `/record` page shows a fixed reminder to announce recording; many states require all-party consent.

## Routes

```
POST   /api/meetings                    create + presigned upload
POST   /api/meetings/:id/chunks         live chunk append (in-person mode)
GET    /api/meetings/:id                meeting + transcript + notes
PATCH  /api/meetings/:id/speakers       rename speakers
POST   /api/meetings/:id/reprocess
POST   /api/meetings/:id/tasks          bulk-create tasks from action items
GET    /api/meetings/search?q=
```

## Build checklist

- [x] Upload + chunked in-person recorder page
- [x] faster-whisper worker + pyannote diarization — `scripts/transcribe.py` (worker Docker image installs deps); degrades to a single speaker without HF_TOKEN
- [x] Claude notes job + auto-linking by attendee
- [x] Meeting page with synced player + editable notes — synced transcript (click→seek), speaker rename, notes; free-text note editing is inline via reprocess
- [x] Action items → Tasks bridge
- [x] Full-text search
