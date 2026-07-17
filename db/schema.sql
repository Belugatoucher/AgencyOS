-- Agency OS — consolidated schema (Postgres 16)
-- Convention: uuid PKs, timestamptz, soft-delete via deleted_at where noted.

create extension if not exists "pgcrypto";

-- ===== Spine =====
create table accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  ghl_location_id text unique,           -- GHL sub-account anchor
  timezone text not null default 'America/New_York',
  brand jsonb not null default '{}',     -- colors, boilerplate
  portal_digest text not null default 'weekly', -- weekly|off (doc 11 client digest)
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id),
  name text not null,
  status text not null default 'active', -- active|paused|done
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null default '',         -- '' until invite/profile fills it (Auth.js creates by email)
  role text not null default 'member',   -- admin|member|client
  email_verified timestamptz,            -- Auth.js: set on first magic-link login
  created_at timestamptz not null default now()
);

-- Auth.js support (magic links, database sessions). Email-only provider via a
-- custom adapter — no oauth accounts table (avoids collision with domain `accounts`).
create table sessions (
  session_token text primary key,
  user_id uuid not null references users(id),
  expires timestamptz not null
);

create table verification_tokens (
  identifier text not null,
  token text not null,
  expires timestamptz not null,
  primary key (identifier, token)
);

create table memberships (
  user_id uuid not null references users(id),
  account_id uuid not null references accounts(id),
  role text not null default 'client',
  primary key (user_id, account_id)
);

-- ===== Files (shared by Review, Assets, Notes) =====
create table files (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id),
  r2_key text not null unique,
  filename text not null,
  mime text not null,
  size_bytes bigint not null,
  checksum text,
  uploaded_by uuid references users(id),
  created_at timestamptz not null default now()
);

-- ===== Review =====
create table review_items (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id),
  project_id uuid references projects(id),
  title text not null,
  client_visible boolean not null default true,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table review_versions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references review_items(id),
  version_no int not null,
  file_id uuid not null references files(id),
  hls_key text,                          -- null until transcoded
  thumb_key text,
  status text not null default 'processing', -- processing|ready|failed
  created_at timestamptz not null default now(),
  unique (item_id, version_no)
);

create table review_comments (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references review_versions(id),
  parent_id uuid references review_comments(id),
  author_id uuid references users(id),
  guest_name text,
  share_link_id uuid,
  timestamp_ms int,                      -- video/audio anchor (ms precision)
  timestamp_end_ms int,                  -- optional range end
  kind text not null default 'note',     -- note|change
  change_status text,                    -- open|accepted|declined|done (kind=change only)
  suggestion jsonb,                      -- {current, proposed} for text changes
  region jsonb,                          -- {x,y,w,h} for stills
  drawing jsonb,                         -- SVG path data
  internal boolean not null default false, -- internal thread: role-filtered from clients/guests (doc 11)
  body text not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table review_approvals (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references review_versions(id),
  decision text not null,                -- approved|changes_requested
  decided_by uuid references users(id),
  guest_name text,
  comment text,
  created_at timestamptz not null default now()
);

create table share_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  kind text not null,                    -- review_item|collection
  target_id uuid not null,
  pin text,
  can_comment boolean not null default true,
  latest_only boolean not null default false,
  expires_at timestamptz not null,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

-- ===== Leads =====
create table leads (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references accounts(id),   -- nullable: agency's own pipeline
  -- shared (synced) fields
  name text, email text, phone text, company text,
  pipeline_id text, stage_id text,
  value_cents bigint, status text, tags text[], source text,
  -- internal-only fields
  owner_id uuid references users(id),
  score int, score_rationale text,
  next_action_at timestamptz,
  internal_notes text,
  ghl_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id),
  kind text not null,                    -- note|stage_change|call|conflict|ghl_event
  body jsonb not null,
  actor_id uuid references users(id),
  created_at timestamptz not null default now()
);

create table sync_map (
  entity text not null,                  -- contact|opportunity
  local_id uuid not null,
  ghl_id text not null,
  last_synced_hash text,
  last_synced_at timestamptz,
  primary key (entity, ghl_id)
);

create table sync_log (
  id uuid primary key default gen_random_uuid(),
  direction text not null,               -- in|out|reconcile
  entity text, ghl_id text,
  payload jsonb, result text, error text,
  created_at timestamptz not null default now()
);

-- ===== Notes =====
create table meetings (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references accounts(id),
  project_id uuid references projects(id),
  lead_id uuid references leads(id),
  title text not null,
  occurred_at timestamptz not null,
  attendees jsonb not null default '[]', -- [{name,email?}]
  audio_file_id uuid references files(id),
  retention text not null default 'keep',-- keep|90d|transcript_only
  client_visible boolean not null default false,
  status text not null default 'uploaded', -- uploaded|transcribing|summarizing|ready|failed
  created_at timestamptz not null default now()
);

create table transcripts (
  meeting_id uuid primary key references meetings(id),
  segments jsonb not null,               -- [{start_ms,end_ms,speaker,text}]
  speakers jsonb not null default '{}',  -- {"SPEAKER_00":"Dana"}
  tsv tsvector generated always as (to_tsvector('english', segments::text)) stored
);
create index transcripts_tsv on transcripts using gin(tsv);

create table meeting_notes (
  meeting_id uuid primary key references meetings(id),
  summary text,
  decisions jsonb default '[]',
  action_items jsonb default '[]',       -- [{text,owner_guess,due_guess,task_id?}]
  followups jsonb default '[]',
  raw jsonb
);

-- ===== Tasks =====
create table tasks (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references accounts(id),
  project_id uuid references projects(id),
  title text not null,
  description text,
  status text not null default 'todo',   -- backlog|todo|in_progress|in_review|done
  priority text not null default 'normal',
  assignee_id uuid references users(id),
  due_at timestamptz,
  estimate_minutes int,
  source text not null default 'manual', -- manual|meeting|review|recurring|asset
  source_id uuid,
  client_visible boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table task_checklist (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id),
  label text not null, done boolean not null default false, position int not null
);

create table task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id),
  parent_id uuid references task_comments(id),
  author_id uuid not null references users(id),
  body text not null,
  created_at timestamptz not null default now()
);

create table recurring_rules (
  id uuid primary key default gen_random_uuid(),
  rrule text not null,
  task_template jsonb not null,
  next_run_at timestamptz not null,
  active boolean not null default true
);

-- ===== Assets =====
create table assets (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id),
  project_id uuid references projects(id),
  file_id uuid not null references files(id),
  type text not null,                    -- logo|photo|video|raw|font|doc|export
  status text not null default 'draft',  -- draft|in_review|approved|archived
  assignee_id uuid references users(id),
  tags text[] not null default '{}',
  rights_note text,
  expires_at timestamptz,
  superseded_by uuid references assets(id),
  thumb_key text,
  created_at timestamptz not null default now()
);

create table collections (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id),
  name text not null,
  is_brand_kit boolean not null default false,
  is_dropbox boolean not null default false,
  created_at timestamptz not null default now()
);

create table collection_assets (
  collection_id uuid references collections(id),
  asset_id uuid references assets(id),
  primary key (collection_id, asset_id)
);

create table asset_usage (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id),
  used_in text not null,                 -- post|review_version|campaign
  used_in_id uuid not null,
  created_at timestamptz not null default now()
);

-- ===== Scheduler =====
create table posts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id),
  channels text[] not null,              -- facebook|instagram|linkedin|tiktok|gbp
  body text,
  channel_overrides jsonb default '{}',  -- {"instagram":{"body":"..."}}
  media uuid[] default '{}',             -- asset ids
  scheduled_at timestamptz,
  status text not null default 'idea',   -- idea|draft|in_approval|approved|scheduled|published|failed
  approval_required boolean not null default true,
  ghl_post_id text,
  published_at timestamptz,
  permalinks jsonb default '{}',
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table post_approvals (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id),
  decision text not null,                -- approved|rejected
  decided_by uuid references users(id),
  guest_name text,
  comment text,
  suggestions jsonb not null default '[]', -- [{current, proposed}] line edits (doc 11: rejections carry anchored suggestions)
  created_at timestamptz not null default now()
);

create table content_slots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id),
  rrule text not null,                   -- e.g. FREQ=WEEKLY;BYDAY=TU,TH,SA
  channels text[] not null,
  label text
);

-- ===== Ops =====
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  kind text not null, body jsonb not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table job_runs (
  id uuid primary key default gen_random_uuid(),
  queue text not null, job text not null,
  status text not null,                  -- ok|failed|retrying
  payload_hash text, error text, duration_ms int,
  created_at timestamptz not null default now()
);

-- Hot-path indexes
create index leads_stage on leads(pipeline_id, stage_id);
create index leads_owner on leads(owner_id) where next_action_at is null;
create index tasks_assignee on tasks(assignee_id, status, due_at);
create index posts_calendar on posts(account_id, scheduled_at);
create index assets_browse on assets(account_id, type, status);
