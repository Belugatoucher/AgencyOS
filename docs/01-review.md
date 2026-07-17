# 01 — Review (Frame.io replacement)

## Purpose

Upload cuts, get frame-accurate comments from the team and from clients, track versions, and get sign-off — without Frame.io's per-seat pricing or making clients create accounts.

## Objects

```
review_items      — a deliverable under a project (e.g. "Q3 Brand Video")
review_versions   — v1, v2, v3... each points to a file; one is `current`
review_comments   — anchored to a version + timestamp (video/audio) or x,y region (image/pdf)
review_approvals  — per version: approved | changes_requested, by whom, when
share_links       — signed public links: item-scoped, expiry, optional PIN, can_comment flag
```

Supported media: video (transcoded to HLS), audio (waveform), images, PDFs. MVP can play the uploaded MP4 directly and add HLS in week two; comments don't care about the transport.

## Flows

**Upload:** member drags a file onto a review item → presigned PUT to R2 → `media` job makes HLS renditions (720p + 1080p), a thumbnail, and a sprite sheet for scrubbing → version appears with processing badge until done.

**Comment:** player pauses on click-to-comment. Comment stores `timestamp_ms` (or `region` for stills), body, author (user or share-link guest name), optional drawing overlay (store as SVG path JSON). Frame-accuracy: timestamps captured from `video.currentTime` at millisecond precision; clicking any comment seeks the player to its timestamp; comments render as markers on the scrub bar. Range comments supported via `timestamp_end_ms` ("this whole section drags"). Replies thread one level. Resolving a comment checks it off; unresolved count shows on the version chip.

**Change suggestions:** any comment can be flagged `kind='change'` (default is `note`). A change carries the timestamp anchor plus a structured ask: what to change and, for text-bearing media, optional `suggestion` (current → proposed wording, e.g. supers, captions, CTA copy). Changes get their own tab on the version — a numbered punch list. Each change is individually `accepted | declined | done`; declining requires a reply so the client sees why. "Send to Tasks" converts open changes into one task with a checklist item per change, back-linked to each timestamp. A new version auto-marks its addressed changes when the editor checks them off, producing a "What changed in v3" list clients see without asking.

**Client review:** member hits Share → link with 14-day expiry + PIN → client opens on any device, no login, types their name once, comments away. Every guest comment notifies the uploader.

**Versioning:** new upload on the same item = next version. Comments stay pinned to their version. A version-compare view plays two versions side by side, sync-locked.

**Approval:** client (or internal approver) hits Approve or Request Changes on the current version. Approval locks the version badge to green and fires a notification + Slack ping. "Request Changes" requires at least one `kind='change'` comment — the button walks them into the suggestion flow instead of accepting a vague "make it pop." A version can't be approved while it has open changes unless the approver explicitly overrides ("approve with exceptions"), which logs the exception list.

## Edge cases

- Guest comments store `guest_name` + share_link id; if that person later becomes a real client user, leave history as-is.
- Deleting a version soft-deletes; approvals are immutable audit rows.
- 2GB+ uploads: multipart presigned upload, resume on failure.
- A share link to an item always shows the *current* version by default but allows browsing older ones unless `latest_only` is set.

## Routes

```
POST   /api/review/items                     create item
POST   /api/review/items/:id/versions        register upload, enqueue transcode
GET    /api/review/items/:id                 item + versions + comment counts
POST   /api/review/versions/:id/comments     add comment (auth or valid share token)
PATCH  /api/review/comments/:id              edit/resolve
POST   /api/review/versions/:id/approval     approve / request changes
POST   /api/review/items/:id/share           mint share link
GET    /r/:token                             public review page (PIN-gated)
```

## Build checklist

- [x] Schema + R2 presigned upload service (shared with Assets module)
- [x] ffmpeg worker: HLS, thumbnail, sprite sheet
- [x] Player page: comment rail, timestamp anchoring — MVP plays the source directly; hls.js attaches to `hlsUrl` when transcoded. Drawing-overlay capture is post-MVP (schema `drawing` column ready)
- [x] Share link mint + public route + PIN gate
- [x] Approvals + notifications
- [ ] Version compare (post-MVP)
