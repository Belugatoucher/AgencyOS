-- 010 — Sites: agentic website builder (docs/18).
-- Intake snapshot → design system proposal (approval) → agent build (approval)
-- → deploy → health + analytics. External systems sit behind adapters
-- (lib/sites/types.ts); these tables only record what happened.

create table sites (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id),
  project_id uuid references projects(id),
  name text not null,
  slug text not null unique,                       -- repo/project naming; lowercase, dashes
  stage text not null default 'intake',            -- intake|design|build|review|live|paused|archived
  domain text,                                     -- production hostname, e.g. example.com
  production_url text,
  preview_url text,
  source_url text,                                 -- the old site we started from
  host text not null default 'manual',             -- manual|cloudflare_pages|vercel|ghl|external
  host_ref text,                                   -- provider project id/name
  repo text not null default 'manual',             -- manual|github
  repo_ref text,                                   -- owner/name
  skill_pack text not null default 'vngrd-default',
  settings jsonb not null default '{}',            -- auto_optimize, health thresholds, analytics source ids
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index sites_account_idx on sites(account_id) where deleted_at is null;

create table site_snapshots (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id),
  source_url text not null,
  status text not null default 'queued',           -- queued|running|done|failed
  pages jsonb not null default '[]',               -- [{url,title,description,h1,headings,wordCount,images,links,status}]
  brand jsonb not null default '{}',               -- {colors[],fonts[],logoUrl,favicon}
  audit jsonb not null default '{}',               -- {brokenLinks[],missingMeta[],slowPages[],notes[]}
  page_count int not null default 0,
  error text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index site_snapshots_site_idx on site_snapshots(site_id, created_at desc);

create table site_design_systems (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id),
  snapshot_id uuid references site_snapshots(id),
  version int not null,
  status text not null default 'drafting',         -- drafting|proposed|approved|rejected|superseded|failed
  brief text,                                      -- direction from the team ("more premium, keep the green")
  tokens jsonb not null default '{}',              -- colors, type scale, spacing, radii, shadows
  components jsonb not null default '[]',          -- [{name,purpose,variants[]}]
  sitemap jsonb not null default '[]',             -- [{path,title,purpose,sections[],sourceUrls[]}]
  rationale text,
  error text,
  decided_by uuid references users(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  unique (site_id, version)
);

create table site_builds (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id),
  design_system_id uuid references site_design_systems(id),
  kind text not null,                              -- initial|change|optimize
  status text not null default 'queued',           -- queued|running|awaiting_review|approved|rejected|failed|cancelled
  brief text,
  runner text not null,                            -- manual|claude_code|...
  skill_pack text not null,
  skill_pack_version text,
  branch text,
  commit_sha text,
  preview_url text,
  summary text,                                    -- agent's own description of what changed
  changes jsonb not null default '[]',             -- [{path,action,note}]
  log jsonb not null default '[]',                 -- [{at,level,message}] capped; full logs stay with the runner
  run_ref text,                                    -- runner's external id
  error text,
  requested_by uuid references users(id),
  decided_by uuid references users(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index site_builds_site_idx on site_builds(site_id, created_at desc);

create table site_deploys (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id),
  build_id uuid references site_builds(id),
  environment text not null,                       -- preview|production
  status text not null default 'queued',           -- queued|building|ready|failed|rolled_back
  provider_ref text,
  url text,
  commit_sha text,
  error text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index site_deploys_site_idx on site_deploys(site_id, created_at desc);

create table site_checks (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id),
  kind text not null,                              -- uptime|ssl|domain|vitals|links|forms
  status text not null,                            -- ok|warn|fail|unknown
  summary text not null,
  detail jsonb not null default '{}',
  checked_at timestamptz not null default now()
);
create index site_checks_latest_idx on site_checks(site_id, kind, checked_at desc);

create table site_metrics_daily (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id),
  source text not null,                            -- gsc|ga4|ghl
  date date not null,
  metrics jsonb not null default '{}',             -- gsc: clicks,impressions,ctr,position · ga4: sessions,users,conversions · ghl: leads
  unique (site_id, source, date)
);

-- Audit item 2: every stored provider token is AES-256-GCM encrypted with
-- APP_ENCRYPTION_KEY. Never returned by any route; never logged.
create table integration_credentials (
  id uuid primary key default gen_random_uuid(),
  scope text not null,                             -- org|account
  account_id uuid references accounts(id),
  provider text not null,                          -- github|cloudflare|vercel|google|pagespeed|...
  label text not null,
  secret_enc text not null,                        -- v1:iv:tag:ciphertext (base64url)
  last4 text,
  meta jsonb not null default '{}',                -- non-secret: account ids, scopes, expiry
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
