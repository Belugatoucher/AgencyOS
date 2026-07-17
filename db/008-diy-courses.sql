-- 008 — Paid DIY courses: a gated Academy section for external learners.
-- Courses gain an access level; entitlements grant one user one paid course.
-- Payments land later (Stripe webhook → insert course_entitlements with
-- source 'stripe'); until then grants are manual via the admin console.

alter table courses add column access text not null default 'internal';  -- internal|paid

create table course_entitlements (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id),
  user_id uuid not null references users(id),
  source text not null default 'manual',        -- manual|stripe
  granted_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (course_id, user_id)
);
