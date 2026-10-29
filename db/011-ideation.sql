-- 011 — Ideation (docs/19): goals per business, rambles, and the items Claude
-- extracts from them. Internal-only. Accepted actions become ordinary tasks
-- (tasks.source = 'ideation', tasks.source_id = idea_items.id).

create table goals (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id),  -- the business (agency internal account for VNGRD itself)
  title text not null,
  detail text,
  horizon text not null default 'quarter',           -- quarter|year|long_term
  metric text,                                       -- what moves when this goal moves ("booked jobs/week")
  target text,                                       -- free text target ("40/week by March")
  due_on date,
  status text not null default 'active',             -- active|achieved|dropped
  position int not null default 0,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index goals_account_idx on goals(account_id, status) where deleted_at is null;

create table idea_sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id),
  title text,
  source text not null,                              -- text|voice
  audio_file_id uuid references files(id),
  transcript text,
  status text not null,                              -- transcribing|thinking|ready|failed
  summary text,
  themes jsonb not null default '[]',
  error text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  deleted_at timestamptz
);
create index idea_sessions_account_idx on idea_sessions(account_id, created_at desc) where deleted_at is null;

create table idea_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references idea_sessions(id),
  account_id uuid not null references accounts(id),
  kind text not null,                                -- action|goal|idea|question|risk
  title text not null,
  detail text,
  goal_id uuid references goals(id),                 -- the active goal this serves, if any
  alignment text not null,                           -- advances|new_direction|off_strategy
  alignment_note text,
  impact int,                                        -- 1-5
  effort int,                                        -- 1-5
  horizon text,                                      -- now|this_week|this_month|this_quarter|later
  suggested_due date,
  quote text,                                        -- the words in the ramble that produced it
  meta jsonb not null default '{}',                  -- goals: {metric, target}
  status text not null default 'proposed',           -- proposed|accepted|dismissed|parked
  task_id uuid references tasks(id),
  created_goal_id uuid references goals(id),
  decided_by uuid references users(id),
  decided_at timestamptz,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index idea_items_session_idx on idea_items(session_id, position);

-- tasks.source gains 'ideation' (text column, no constraint change needed).
