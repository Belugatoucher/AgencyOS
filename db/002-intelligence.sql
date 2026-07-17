-- 002 — Intelligence module (requires: create extension vector;)

create extension if not exists vector;

create table hooks (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references accounts(id),        -- null = global library
  text text not null,
  format text not null,        -- question|callout|stat|story_open|contrarian|pain|curiosity|social_proof
  platform text,
  niche_tags text[] not null default '{}',
  source text not null default 'manual',          -- manual|swipe|our_ad|organic|import
  source_url text,
  metrics jsonb,                                  -- {hook_rate, ctr, ...} when known
  embedding vector(384),
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index hooks_embedding on hooks using hnsw (embedding vector_cosine_ops);

create table creatives (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id),
  asset_ids uuid[] not null default '{}',
  platform text not null,
  metrics jsonb not null default '{}',            -- hook_rate, hold_rate, ctr, cpm, cpa, roas
  spend_cents bigint not null default 0,
  is_winning boolean not null default false,      -- computed: top quartile primary KPI, min spend
  learning text,
  embedding vector(384),
  period_start date, period_end date,
  created_at timestamptz not null default now()
);

create table research_docs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references accounts(id),        -- null = general market research
  kind text not null,                             -- competitor|audience|voc|trend|strategy
  title text not null,
  file_id uuid references files(id),
  raw_text text,
  status text not null default 'processing',      -- processing|ready|failed
  created_at timestamptz not null default now()
);

create table research_chunks (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references research_docs(id) on delete cascade,
  chunk_text text not null,
  position int not null,
  embedding vector(384)
);
create index research_chunks_embedding on research_chunks using hnsw (embedding vector_cosine_ops);

create table client_brains (
  account_id uuid primary key references accounts(id),
  offer text, icp text, positioning text,
  voice jsonb default '{}',                       -- {do:[], dont:[], samples:[]}
  objections jsonb default '[]',
  proof_points jsonb default '[]',                -- the ONLY claims source
  compliance_nos jsonb default '[]',              -- hard blocks
  goals_current_quarter text,
  learnings jsonb default '[]',                   -- [{text, source, added_at}]
  version int not null default 1,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now()
);

create table brain_versions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id),
  version int not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create table brain_suggestions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id),
  field text not null,                            -- learnings|objections|...
  proposed jsonb not null,
  source text not null,                           -- meeting|creative
  source_id uuid,
  status text not null default 'pending',         -- pending|accepted|rejected
  created_at timestamptz not null default now()
);

create table ai_threads (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id),
  user_id uuid not null references users(id),
  title text,
  messages jsonb not null default '[]',
  retrieval_ids jsonb not null default '[]',      -- audit trail of what was used
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
