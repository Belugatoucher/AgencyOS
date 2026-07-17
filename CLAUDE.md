# CLAUDE.md — Agency OS build conventions

You are building Agency OS, an internal marketing-agency platform. The full specs live in `docs/` — read `docs/00-architecture.md` first, then the module doc for the current task. Follow the roadmap order in `docs/07-roadmap.md` unless told otherwise.

## Stack (fixed — do not substitute)

Next.js 15 App Router · TypeScript strict · PostgreSQL 16 + Drizzle ORM · BullMQ + Redis · Cloudflare R2 via presigned uploads · Auth.js magic links · Tailwind + shadcn/ui · TanStack Query · Zod on every boundary.

## Hard rules

1. **Schema is law.** `db/schema.sql` + `db/002-intelligence.sql` define the data model. Implement it in Drizzle; if a spec forces a schema change, change the SQL file in the same PR and say so.
2. **Services own logic.** Route handlers = parse (Zod) → auth check → call `lib/services/*` → return. Workers import the same services. No business logic in routes or components.
3. **Every query is account-scoped.** All reads/writes go through the access helper (`lib/access.ts`): it applies role rules (admin/member see per `org_settings`, client sees memberships + `client_visible`). Never write a raw account-unscoped query for user-facing data.
4. **Jobs, not inline work.** Anything >2s (transcode, transcribe, embed, sync, publish, PDF) is a BullMQ job with retry + a `job_runs` row. Webhook handlers verify, enqueue, 200 in <1s.
5. **Files never proxy through the app.** Browser ↔ R2 presigned only.
6. **AI calls** use the prompts in `prompts/` verbatim as the base; runtime context fills the templates. JSON outputs: parse with one retry, then fail the job loudly.
7. **Mutations return the full record.** Frontend uses TanStack Query with optimistic updates + invalidation.
8. **Soft delete** (`deleted_at`) everywhere users can destroy things; hard delete only via admin tooling.
9. **Security controls are spec.** `docs/98-security-audit.md` 🔴/🟡 items are requirements: encrypted token storage, share-link/PIN hardening, the client-role route-matrix test in CI, magic-link limits, header policy, and read-only tools on retrieval chats. New endpoints state which controls apply.

## Style

- Server Components by default; `"use client"` only where interaction demands it.
- Colocate: `app/(app)/leads/` holds its page, components, and hooks. Shared UI in `components/`.
- Errors: typed `Result` returns from services; no thrown strings; user-facing messages are human, logged messages are specific.
- Tests: Vitest for services (sync logic, access rules, echo suppression get priority); Playwright smoke per module before marking a checklist item done.
- Commits per checklist item from the module doc's build checklist; check items off in the doc in the same commit.

## Definition of done (per module)

Schema migrated · services tested · role checks verified for `client` role · jobs retry + surface in `/admin/health` · module checklist fully ticked.

## When specs conflict or are silent

Prefer: 00-architecture > module doc > your judgment. If you make a judgment call, leave a `// DECISION:` comment and list it in the PR description.
