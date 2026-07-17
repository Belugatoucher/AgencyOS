-- 006 — Manual-first leads

alter table accounts add column if not exists lead_mode text not null default 'manual';   -- manual|ghl
alter table accounts add column if not exists portal_leads text not null default 'off';   -- off|summary|full

create table pipelines (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id),
  name text not null,
  position int not null default 0,
  intake_token text unique,                    -- public form endpoint, null = disabled
  ghl_pipeline_id text                          -- set in ghl mode
);

create table stages (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references pipelines(id),
  name text not null,
  color text,
  position int not null,
  is_won boolean not null default false,
  is_lost boolean not null default false,
  ghl_stage_id text
);

-- leads: repoint pipeline/stage to local tables; account_id now = whose pipeline (agency internal account or a client account)
alter table leads add column if not exists pipeline_uuid uuid references pipelines(id);
alter table leads add column if not exists stage_uuid uuid references stages(id);
alter table leads add column if not exists client_hidden boolean not null default false;
alter table leads add column if not exists links jsonb not null default '[]';   -- website, socials
-- legacy text columns pipeline_id/stage_id retained for ghl mirror ids; drop after ghl connector lands

create index leads_board on leads(account_id, pipeline_uuid, stage_uuid);
