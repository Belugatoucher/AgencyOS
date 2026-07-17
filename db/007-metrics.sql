-- 007 — Metrics ingestion (docs/09). Added during implementation: docs/09
-- defines this model inline but no pack SQL file carried it (CLAUDE.md rule 1:
-- schema files are law, so the tables land here in the same PR).

create table metric_sources (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id),
  kind text not null,                              -- meta|tiktok|ga4|ghl|csv
  config jsonb not null default '{}',              -- saved column mappings per source
  last_pulled_at timestamptz,
  created_at timestamptz not null default now()
);

create table metric_rows (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references metric_sources(id),
  external_id text not null,
  entity_kind text not null,                       -- ad|adset|campaign|post
  date date not null,
  metrics jsonb not null default '{}',
  creative_match uuid references creatives(id),
  -- re-import is idempotent: upsert on source + external_id + date
  unique (source_id, external_id, date)
);
