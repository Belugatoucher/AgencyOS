-- 005 — Pre-sales: deck autofill, documents, gcal, sales roles

create table deck_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  canva_template_id text not null,
  field_schema jsonb not null default '{}',   -- synced from Canva dataset API
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table deck_runs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id),
  template_id uuid not null references deck_templates(id),
  extracted jsonb not null default '{}',      -- {field: {value, evidence_ms}}
  canva_design_id text,
  edit_url text,
  pdf_file_id uuid references files(id),
  status text not null default 'extracted',   -- extracted|reviewed|generated|failed
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references accounts(id),
  lead_id uuid references leads(id),
  kind text not null,                         -- deck|proposal|contract|report|brief|invoice|misc
  file_id uuid not null references files(id),
  title text not null,
  client_visible boolean not null default false,
  signed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table users add column if not exists gcal_tokens jsonb;          -- encrypted at rest
alter table users add column if not exists gcal_default_rule text not null default 'never'; -- never|always|high_priority
alter table users add column if not exists sales_role text;            -- setter|closer|null

alter table tasks add column if not exists gcal_sync boolean not null default false;
alter table tasks add column if not exists gcal_event_id text;

-- structured call dispositions live in lead_activities.body:
-- {disposition: no_answer|not_qualified|booked|showed|no_show|closed_won|closed_lost,
--  objection?: text, duration_s?: int, meeting_id?: uuid}
create index lead_activities_calls on lead_activities(lead_id) where kind = 'call';
