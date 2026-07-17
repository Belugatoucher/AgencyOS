-- 004 — Academy: SOPs, training, notebook scope

create table sops (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null,          -- client_mgmt|creative|media_buying|sales|ops|tools
  tags text[] not null default '{}',
  body text not null,              -- markdown with heading anchors
  owner_id uuid references users(id),
  status text not null default 'draft',   -- draft|published|needs_review
  review_every_days int not null default 180,
  last_reviewed_at timestamptz,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sop_versions (
  id uuid primary key default gen_random_uuid(),
  sop_id uuid not null references sops(id),
  version int not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

-- internal knowledge chunks (SOPs + lesson transcripts) — separate scope from client research
create table kb_chunks (
  id uuid primary key default gen_random_uuid(),
  source text not null,            -- sop|lesson
  source_id uuid not null,
  anchor text,                     -- sop heading slug
  start_ms int,                    -- lesson transcript position
  chunk_text text not null,
  embedding vector(384)
);
create index kb_chunks_embedding on kb_chunks using hnsw (embedding vector_cosine_ops);

create table courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  audience_roles text[] not null default '{}',
  required boolean not null default false,
  position int not null default 0,
  status text not null default 'draft'     -- draft|published|archived
);

create table lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id),
  position int not null,
  title text not null,
  kind text not null,              -- video|sop|doc|quiz
  video_file_id uuid references files(id),
  hls_key text,
  transcript jsonb,                -- segments, filled by whisper worker
  chapters jsonb default '[]',
  sop_id uuid references sops(id),
  body text,
  est_minutes int,
  quiz jsonb                       -- {pass_threshold, questions[]}
);

create table training_assignments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id),
  roles text[] default '{}',       -- auto-assign on role match
  user_ids uuid[] default '{}',    -- manual assigns
  due_days int not null default 14,
  active boolean not null default true
);

create table lesson_progress (
  user_id uuid not null references users(id),
  lesson_id uuid not null references lessons(id),
  status text not null default 'todo',     -- todo|in_progress|done
  score numeric,
  attempts int not null default 0,
  completed_at timestamptz,
  primary key (user_id, lesson_id)
);

create table notebook_gaps (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  asked_by uuid references users(id),
  confidence text not null,        -- thin|none
  resolved_sop_id uuid references sops(id),
  created_at timestamptz not null default now()
);
