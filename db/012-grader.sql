-- 012 — Website grader (docs/18 "Grader", docs/offers/web-seo.md).
-- One row per graded site: public lead-magnet runs (with the visitor's contact
-- details and a lead), internal prospect runs, and bulk prospect batches.
-- The public report link is the token (audit item 1: >=128-bit, server-side
-- expiry, no contact details ever rendered on the public page).

create table grader_reports (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,                      -- 24 random bytes, base64url
  source text not null,                            -- public|internal|bulk
  batch_id text,                                   -- bulk runs share one
  url text not null,
  business_name text,
  city text,
  keyword text,                                    -- the main service, for the Maps grid
  contact_name text,                               -- public runs only; never shown on the report
  contact_email text,
  contact_phone text,
  lead_id uuid references leads(id),
  utm jsonb not null default '{}',                 -- public runs: utm_source/medium/campaign/content (offer validation)
  status text not null default 'queued',           -- queued|running|done|failed
  score int,
  letter text,
  result jsonb not null default '{}',              -- {sections, topFixes, summary}
  signals jsonb not null default '{}',             -- {home, crawl, psi, ssl, fetchMs, checked:{psi,maps}}
  maps jsonb,                                      -- grid summary + competitor, when checked
  error text,
  views int not null default 0,
  last_viewed_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  expires_at timestamptz not null,                 -- public link stops working after this
  deleted_at timestamptz
);
create index grader_reports_created_idx on grader_reports(created_at desc) where deleted_at is null;
create index grader_reports_batch_idx on grader_reports(batch_id) where batch_id is not null;
