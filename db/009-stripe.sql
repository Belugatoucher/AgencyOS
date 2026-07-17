-- 009 — Stripe checkout for paid DIY courses (extends db/008).
-- Checkout Sessions are created inline (price from courses.price_cents, no
-- dashboard products needed); the checkout.session.completed webhook grants
-- the entitlement (source 'stripe') and records the purchase for audit.

alter table courses add column price_cents int;  -- required before a paid course can be sold

create table course_purchases (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id),
  user_id uuid references users(id),            -- filled at fulfillment (find-or-create by email)
  email text not null,
  stripe_session_id text not null unique,       -- idempotency key: one grant per session
  amount_cents int not null,
  status text not null default 'paid',
  created_at timestamptz not null default now()
);
