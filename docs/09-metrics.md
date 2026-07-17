# 09 — Metrics Ingestion (Core)

## Purpose

One pipeline that feeds performance numbers into Intelligence (winning creatives), Scheduler (post results), and Reports. Without this, "data-driven" is decoration.

## Sources, in build order

1. **CSV import (day one)** — Meta Ads, TikTok Ads, GA4 exports. Column-mapping UI with saved mappings per source; re-import is idempotent (upsert on `source + external_id + date`).
2. **GHL** — post-level social stats where Social Planner exposes them; pulled by the existing `ghl` worker.
3. **Meta Marketing API (early v1.5)** — nightly pull per connected ad account: campaign → ad set → ad, spend + results. One adapter interface so TikTok/Google slot in later:
   `MetricsAdapter { listEntities(), pullDaily(date) }`.

## Model

```
metric_sources    — account_id, kind (meta|tiktok|ga4|ghl|csv), config, last_pulled_at
metric_rows       — source_id, external_id, entity_kind (ad|adset|campaign|post),
                    date, metrics jsonb, creative_match uuid? → creatives.id
```

## Matching

Ad → creative matching: by ad name convention first (`{creative_id}` slug in ad names — enforce via SOP), fuzzy name match as fallback, manual link UI for stragglers. A weekly digest lists unmatched spend so it never silently rots.

## Rollups

Nightly job aggregates `metric_rows` into `creatives.metrics` (period totals + rates) and recomputes `is_winning` (top quartile on the account's primary KPI, min spend from account settings). Same rollup feeds Reports.

## Build checklist

- [x] CSV importer + mapping UI + idempotent upsert — mapping-driven import, saved per source, upsert on (source, external_id, date); mapping UI is the JSON body today, a column-picker UI follows
- [x] metric_rows schema + nightly rollup + is_winning compute — db/007-metrics.sql; `metrics-rollup` cron (02:30) aggregates into creatives.metrics + recomputes winners
- [x] Ad↔creative matcher + unmatched digest — id-slug in ad name + manual link route; fuzzy name fallback deferred (creatives carry no name field); `unmatched-spend-digest` cron Mon 09:00
- [ ] Meta API adapter (v1.5 gate)
