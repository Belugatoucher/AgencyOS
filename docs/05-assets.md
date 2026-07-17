# 05 — Assets

## Purpose

Every logo, raw clip, photo shoot, font, and final export findable in five seconds, with a status that answers "is this approved, and where has it been used?" Ends the "final_v3_FINAL(2).mp4 in someone's Drive" era.

## Objects

```
assets            — file ref, account_id, project_id?, type (logo|photo|video|raw|font|doc|export),
                    status (draft | in_review | approved | archived),
                    assignee_id? (who's working it), tags[], rights_note, expires_at?
asset_versions    — supersede chain, latest wins
asset_usage       — links: used in scheduled post X, review item Y, campaign Z
collections       — named sets ("Spring Shoot 2026", "Brand Kit") sharable to clients
```

## Behaviors

- **Brand Kit per account:** a pinned collection (logos, fonts, colors as swatch entries, boilerplate copy). Scheduler and Review both surface it in a side panel so nobody hunts for the right logo mid-task.
- **Assignment:** an asset in `draft` can be assigned ("Sam: color-grade these 14 clips"), which shows in Sam's My Tasks via an auto-task.
- **Rights + expiry:** stock licenses and talent releases get `rights_note` + `expires_at`; a weekly job flags anything expiring in 30 days and anything expired still marked `approved`.
- **Usage tracking:** when a Scheduler post or Review version references an asset, an `asset_usage` row appears. Asset page answers "where has this run?"
- **Client sharing:** collections get share links (same signed-link service as Review). Clients can upload *into* a drop-box collection ("send us your raw photos") without seeing anything else.
- **Search:** filename, tags, type, account, status. Image thumbnails via the media worker; video assets reuse Review's thumbnail job.

## Dedup

Checksum on upload; identical file in the same account → warn and offer to link instead of duplicate.

## Routes

```
GET    /api/assets?account=&type=&status=&tag=&q=
POST   /api/assets                          presigned upload + record
PATCH  /api/assets/:id                      status, assignment, tags, rights
POST   /api/collections
POST   /api/collections/:id/share
GET    /api/assets/:id/usage
```

## Build checklist

- [ ] Schema + upload (reuses Review's file service)
- [ ] Grid browser with filters + thumbnails
- [ ] Collections + share links + client drop-box
- [ ] Brand Kit panel component (consumed by Scheduler + Review)
- [ ] Rights expiry job
- [ ] Usage backlinks
