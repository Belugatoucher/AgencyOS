-- 003 — Theming, Slack, extras deltas

create table org_settings (
  id int primary key default 1,
  theme jsonb not null default '{}',            -- agency theme tokens (doc 14)
  scoped_members boolean not null default false,
  services_blurb text,
  check (id = 1)
);

-- accounts.brand jsonb already exists; portal theme lives at brand.theme
alter table accounts add column if not exists kind text not null default 'client';   -- client|internal|personal
alter table accounts add column if not exists owner_user_id uuid references users(id);

alter table users add column if not exists slack_id text unique;

create table slack_routes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references accounts(id),      -- null = org-wide route
  channel_id text not null,
  kinds text[] not null default '{}',           -- empty = all kinds
  active boolean not null default true
);

create table ideas (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references accounts(id),
  user_id uuid not null references users(id),
  body text not null,
  source text not null default 'manual',        -- manual|share|voice|ai_weekly|slack
  status text not null default 'inbox',         -- inbox|promoted|archived
  promoted_to text, promoted_id uuid,
  created_at timestamptz not null default now()
);

create table intake_forms (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id),
  token text not null unique,
  sections jsonb not null default '{}',
  status text not null default 'sent',          -- sent|in_progress|submitted|committed
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table project_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  task_set jsonb not null default '[]',
  default_slots jsonb not null default '[]'
);
