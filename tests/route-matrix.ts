import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import {
  accounts,
  assets,
  brainSuggestions,
  creatives,
  files,
  intakeForms,
  leads,
  meetings,
  memberships,
  metricRows,
  metricSources,
  pipelines,
  posts,
  reviewItems,
  reviewVersions,
  sessions,
  shareLinks,
  tasks,
  users,
} from "../lib/db/schema";

// Route-matrix test (audit item 5): execute API routes as
// admin / member / client-of-A / anonymous against fixtures from TWO accounts,
// asserting cross-account reads return 404/empty and mutations are refused.
// Exits non-zero on any mismatch so CI fails the build.
//
// Sessions are minted directly in the DB (database-session strategy), so this
// needs DATABASE_URL and a running app at APP_URL. Cookie name matches Auth.js
// v5 over http: `authjs.session-token`.

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://agencyos@localhost:5432/agencyos";

const client = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
const db = drizzle(client, { schema: { accounts, memberships, sessions, tasks, users } });

type Fixture = {
  accountA: string;
  accountB: string;
  taskAVisible: string; // client_visible task in A
  taskAHidden: string; // hidden task in A
  taskB: string; // task in B
  pipelineB: string; // pipeline in B
  leadB: string; // lead in B
  assetB: string; // asset in B
  reviewItemB: string; // review item in B
  shareToken: string; // public share link to reviewItemB (no PIN)
  meetingB: string; // meeting in B
  postB: string; // post in B
  creativeB: string; // creative in B (Intelligence)
  suggestionB: string; // pending brain suggestion in B
  metricSourceB: string; // csv metric source in B
  metricRowB: string; // unmatched ad metric row in B
  intakeB: string; // intake form id in B (Onboarding)
  intakeTokenB: string; // its public token
  reviewVersionB: string; // version under reviewItemB (comment-read scoping)
  courseId: string; // published Academy course (global, internal-only)
  paidCourseEntitled: string; // paid course clientA is entitled to
  paidCourseLocked: string; // paid course clientA is NOT entitled to
  cookies: Record<"admin" | "member" | "clientA" | "anon", string | null>;
};

async function mintSession(userId: string): Promise<string> {
  const token = randomUUID();
  await db.insert(sessions).values({
    sessionToken: token,
    userId,
    expires: new Date(Date.now() + 60 * 60 * 1000),
  });
  return `authjs.session-token=${token}`;
}

async function ensureUser(email: string, role: "admin" | "member" | "client"): Promise<string> {
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  if (existing) {
    if (existing.role !== role) await db.update(users).set({ role }).where(eq(users.id, existing.id));
    return existing.id;
  }
  const [u] = await db.insert(users).values({ email, name: email, role }).returning();
  return u!.id;
}

async function setup(): Promise<Fixture> {
  const tag = Date.now();
  const [a] = await db.insert(accounts).values({ name: `Matrix A ${tag}` }).returning();
  const [b] = await db.insert(accounts).values({ name: `Matrix B ${tag}` }).returning();

  const adminId = await ensureUser("ryan@vngrd.media", "admin");
  const memberId = await ensureUser(`matrix-member-${tag}@example.com`, "member");
  const clientAId = await ensureUser(`matrix-clientA-${tag}@example.com`, "client");

  await db.insert(memberships).values({ userId: clientAId, accountId: a!.id, role: "client" });

  const [taskAVisible] = await db
    .insert(tasks)
    .values({ title: "A visible", accountId: a!.id, clientVisible: true, status: "todo" })
    .returning();
  const [taskAHidden] = await db
    .insert(tasks)
    .values({ title: "A hidden", accountId: a!.id, clientVisible: false, status: "todo" })
    .returning();
  const [taskB] = await db
    .insert(tasks)
    .values({ title: "B task", accountId: b!.id, clientVisible: true, status: "todo" })
    .returning();

  // A lead in account B — leads are internal-only, so a client of A must never reach it.
  const [pipelineB] = await db
    .insert(pipelines)
    .values({ accountId: b!.id, name: "Matrix B pipeline" })
    .returning();
  const [leadB] = await db
    .insert(leads)
    .values({ accountId: b!.id, pipelineUuid: pipelineB!.id, name: "B lead" })
    .returning();

  // An asset in account B (needs a file row in B).
  const [fileB] = await db
    .insert(files)
    .values({ accountId: b!.id, r2Key: `${b!.id}/uploads/${tag}/logo.png`, filename: "logo.png", mime: "image/png", sizeBytes: 10 })
    .returning();
  const [assetB] = await db
    .insert(assets)
    .values({ accountId: b!.id, fileId: fileB!.id, type: "logo" })
    .returning();

  // A client_visible review item in B + a no-PIN share link to it.
  const [reviewItemB] = await db
    .insert(reviewItems)
    .values({ accountId: b!.id, title: "B review", clientVisible: true })
    .returning();
  const shareToken = randomBytes(24).toString("base64url");
  await db.insert(shareLinks).values({
    token: shareToken,
    kind: "review_item",
    targetId: reviewItemB!.id,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });

  // A meeting in account B — Notes are internal-only.
  const [meetingB] = await db
    .insert(meetings)
    .values({ accountId: b!.id, title: "B standup", occurredAt: new Date() })
    .returning();

  // A post in account B.
  const [postB] = await db
    .insert(posts)
    .values({ accountId: b!.id, channels: ["linkedin"], body: "B post", status: "draft" })
    .returning();

  // Intelligence + Metrics fixtures in B (all internal-only surfaces).
  const [creativeB] = await db
    .insert(creatives)
    .values({ accountId: b!.id, platform: "meta", metrics: { roas: 2 }, spendCents: 20_000 })
    .returning();
  const [suggestionB] = await db
    .insert(brainSuggestions)
    .values({ accountId: b!.id, field: "learnings", proposed: { text: "matrix probe" }, source: "manual" })
    .returning();
  const [metricSourceB] = await db
    .insert(metricSources)
    .values({ accountId: b!.id, kind: "csv", config: {} })
    .returning();
  const [metricRowB] = await db
    .insert(metricRows)
    .values({
      sourceId: metricSourceB!.id,
      externalId: `matrix-${tag}`,
      entityKind: "ad",
      date: "2026-07-01",
      metrics: { spend: 10 },
    })
    .returning();

  // Onboarding intake in B (submitted, ready to commit) + a version on the
  // B review item so comment reads can be probed cross-account.
  const intakeTokenB = randomBytes(24).toString("base64url");
  const [intakeB] = await db
    .insert(intakeForms)
    .values({
      accountId: b!.id,
      token: intakeTokenB,
      sections: { offer: "matrix probe offer" },
      status: "submitted",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })
    .returning();
  const [reviewVersionB] = await db
    .insert(reviewVersions)
    .values({ itemId: reviewItemB!.id, versionNo: 1, fileId: fileB!.id, status: "ready" })
    .returning();

  // Academy fixture: a published course for lesson-create probes, plus two
  // paid DIY courses — clientA is entitled to exactly one of them.
  const { courses, courseEntitlements } = await import("../lib/db/schema");
  const [course] = await db
    .insert(courses)
    .values({ title: `Matrix course ${tag}`, status: "published" })
    .returning();
  const [paidEntitled] = await db
    .insert(courses)
    .values({ title: `Matrix DIY entitled ${tag}`, status: "published", access: "paid" })
    .returning();
  const [paidLocked] = await db
    .insert(courses)
    .values({ title: `Matrix DIY locked ${tag}`, status: "published", access: "paid" })
    .returning();
  await db.insert(courseEntitlements).values({ courseId: paidEntitled!.id, userId: clientAId });

  return {
    accountA: a!.id,
    accountB: b!.id,
    taskAVisible: taskAVisible!.id,
    taskAHidden: taskAHidden!.id,
    taskB: taskB!.id,
    pipelineB: pipelineB!.id,
    leadB: leadB!.id,
    assetB: assetB!.id,
    reviewItemB: reviewItemB!.id,
    shareToken,
    meetingB: meetingB!.id,
    postB: postB!.id,
    creativeB: creativeB!.id,
    suggestionB: suggestionB!.id,
    metricSourceB: metricSourceB!.id,
    metricRowB: metricRowB!.id,
    intakeB: intakeB!.id,
    intakeTokenB,
    reviewVersionB: reviewVersionB!.id,
    courseId: course!.id,
    paidCourseEntitled: paidEntitled!.id,
    paidCourseLocked: paidLocked!.id,
    cookies: {
      admin: await mintSession(adminId),
      member: await mintSession(memberId),
      clientA: await mintSession(clientAId),
      anon: null,
    },
  };
}

type Role = "admin" | "member" | "clientA" | "anon";
type Case = {
  name: string;
  method: string;
  path: (f: Fixture) => string;
  body?: (f: Fixture) => unknown;
  expect: Record<Role, number | number[]>;
};

const ANON = 401;

const CASES: Case[] = [
  {
    name: "GET /api/accounts",
    method: "GET",
    path: () => "/api/accounts",
    expect: { admin: 200, member: 200, clientA: 200, anon: ANON },
  },
  {
    name: "GET account B (client of A must not see)",
    method: "GET",
    path: (f) => `/api/accounts/${f.accountB}`,
    expect: { admin: 200, member: 200, clientA: 404, anon: ANON },
  },
  {
    name: "GET account A (client of A may see)",
    method: "GET",
    path: (f) => `/api/accounts/${f.accountA}`,
    expect: { admin: 200, member: 200, clientA: 200, anon: ANON },
  },
  {
    name: "POST /api/accounts (clients cannot create)",
    method: "POST",
    path: () => "/api/accounts",
    body: () => ({ name: "matrix probe" }),
    expect: { admin: 201, member: 201, clientA: 403, anon: ANON },
  },
  {
    name: "GET /api/team (internal only)",
    method: "GET",
    path: () => "/api/team",
    expect: { admin: 200, member: 200, clientA: 403, anon: ANON },
  },
  {
    name: "GET account B files (cross-account leak check)",
    method: "GET",
    path: (f) => `/api/accounts/${f.accountB}/files`,
    expect: { admin: 200, member: 200, clientA: 404, anon: ANON },
  },
  {
    name: "GET account B tasks list filter (client sees empty, not B's rows)",
    method: "GET",
    path: (f) => `/api/tasks?account=${f.accountB}`,
    expect: { admin: 200, member: 200, clientA: 200, anon: ANON },
  },
  {
    name: "GET task in B (client of A: not found)",
    method: "GET",
    path: (f) => `/api/tasks/${f.taskB}`,
    expect: { admin: 200, member: 200, clientA: 404, anon: ANON },
  },
  {
    name: "GET hidden task in A (client: not found even in own account)",
    method: "GET",
    path: (f) => `/api/tasks/${f.taskAHidden}`,
    expect: { admin: 200, member: 200, clientA: 404, anon: ANON },
  },
  {
    name: "GET client-visible task in A (client may see)",
    method: "GET",
    path: (f) => `/api/tasks/${f.taskAVisible}`,
    expect: { admin: 200, member: 200, clientA: 200, anon: ANON },
  },
  {
    name: "POST task (clients cannot create)",
    method: "POST",
    path: () => "/api/tasks",
    body: (f) => ({ title: "probe", accountId: f.accountA }),
    expect: { admin: 201, member: 201, clientA: 403, anon: ANON },
  },
  {
    name: "PATCH task in B (client cannot touch)",
    method: "PATCH",
    path: (f) => `/api/tasks/${f.taskB}`,
    body: () => ({ status: "done" }),
    expect: { admin: 200, member: 200, clientA: 404, anon: ANON },
  },
  {
    name: "POST comment on B task (client refused)",
    method: "POST",
    path: (f) => `/api/tasks/${f.taskB}/comments`,
    body: () => ({ body: "probe" }),
    expect: { admin: 201, member: 201, clientA: 403, anon: ANON },
  },
  {
    name: "POST recurring rule (internal only)",
    method: "POST",
    path: () => "/api/recurring-rules",
    body: () => ({ rrule: "FREQ=WEEKLY;BYDAY=MO", taskTemplate: { title: "weekly" } }),
    expect: { admin: 201, member: 201, clientA: 403, anon: ANON },
  },
  // ===== Leads (internal-only; portal leads page deferred to doc 11) =====
  {
    name: "GET /api/leads (internal only)",
    method: "GET",
    path: () => "/api/leads",
    expect: { admin: 200, member: 200, clientA: 403, anon: ANON },
  },
  {
    name: "GET /api/leads/overview (internal only)",
    method: "GET",
    path: () => "/api/leads/overview",
    expect: { admin: 200, member: 200, clientA: 403, anon: ANON },
  },
  {
    name: "GET pipelines for account B (internal only)",
    method: "GET",
    path: (f) => `/api/pipelines?account=${f.accountB}`,
    expect: { admin: 200, member: 200, clientA: 403, anon: ANON },
  },
  {
    name: "POST pipeline (clients cannot create)",
    method: "POST",
    path: () => "/api/pipelines",
    body: (f) => ({ name: "probe", accountId: f.accountA }),
    expect: { admin: 201, member: 201, clientA: 403, anon: ANON },
  },
  {
    name: "GET lead in B (client of A refused)",
    method: "GET",
    path: (f) => `/api/leads/${f.leadB}`,
    expect: { admin: 200, member: 200, clientA: 403, anon: ANON },
  },
  {
    name: "PATCH lead in B (client of A refused)",
    method: "PATCH",
    path: (f) => `/api/leads/${f.leadB}`,
    body: () => ({ name: "hacked" }),
    expect: { admin: 200, member: 200, clientA: 403, anon: ANON },
  },
  {
    name: "POST enqueue score on B lead (client refused)",
    method: "POST",
    path: (f) => `/api/leads/${f.leadB}/score`,
    expect: { admin: 202, member: 202, clientA: 403, anon: ANON },
  },
  // ===== Assets (account-scoped; clients read own accounts only) =====
  {
    name: "GET assets in account B (client of A: not found)",
    method: "GET",
    path: (f) => `/api/assets?account=${f.accountB}`,
    expect: { admin: 200, member: 200, clientA: 404, anon: ANON },
  },
  {
    name: "POST asset (clients cannot create)",
    method: "POST",
    path: () => "/api/assets",
    body: (f) => ({ accountId: f.accountA, fileId: f.assetB, type: "logo" }),
    expect: { admin: [400, 201], member: [400, 201], clientA: 403, anon: ANON },
  },
  {
    name: "PATCH asset in B (client of A refused)",
    method: "PATCH",
    path: (f) => `/api/assets/${f.assetB}`,
    body: () => ({ status: "approved" }),
    expect: { admin: 200, member: 200, clientA: 404, anon: ANON },
  },
  {
    name: "GET asset usage in B (client refused)",
    method: "GET",
    path: (f) => `/api/assets/${f.assetB}/usage`,
    expect: { admin: 200, member: 200, clientA: 404, anon: ANON },
  },
  // ===== Review =====
  {
    name: "GET review items in B (client of A: not found)",
    method: "GET",
    path: (f) => `/api/review/items?account=${f.accountB}`,
    expect: { admin: 200, member: 200, clientA: 404, anon: ANON },
  },
  {
    name: "GET review item in B (client of A: not found)",
    method: "GET",
    path: (f) => `/api/review/items/${f.reviewItemB}`,
    expect: { admin: 200, member: 200, clientA: 404, anon: ANON },
  },
  {
    name: "POST review item (clients cannot create)",
    method: "POST",
    path: () => "/api/review/items",
    body: (f) => ({ accountId: f.accountA, title: "probe" }),
    expect: { admin: 201, member: 201, clientA: 403, anon: ANON },
  },
  {
    name: "POST share mint on B item (client refused)",
    method: "POST",
    path: (f) => `/api/review/items/${f.reviewItemB}/share`,
    body: () => ({}),
    expect: { admin: 201, member: 201, clientA: 404, anon: ANON },
  },
  // Public share resolution is intentionally session-agnostic: every role
  // (including anon) reaches it identically; a valid no-PIN token → 200 ok.
  {
    name: "GET public share (no session required)",
    method: "GET",
    path: (f) => `/api/share/${f.shareToken}`,
    expect: { admin: 200, member: 200, clientA: 200, anon: 200 },
  },
  {
    name: "GET public share bad token → 404",
    method: "GET",
    path: () => `/api/share/definitelynotarealtokenxxxxxxxx`,
    expect: { admin: 404, member: 404, clientA: 404, anon: 404 },
  },
  // ===== Notes (internal-only; portal exposure deferred to doc 11) =====
  {
    name: "GET /api/meetings (internal only)",
    method: "GET",
    path: () => "/api/meetings",
    expect: { admin: 200, member: 200, clientA: 403, anon: ANON },
  },
  {
    name: "POST meeting (clients cannot create)",
    method: "POST",
    path: (f) => "/api/meetings",
    body: (f) => ({ title: "probe", accountId: f.accountA }),
    expect: { admin: 201, member: 201, clientA: 403, anon: ANON },
  },
  {
    name: "GET meeting in B (client of A refused)",
    method: "GET",
    path: (f) => `/api/meetings/${f.meetingB}`,
    expect: { admin: 200, member: 200, clientA: 404, anon: ANON },
  },
  {
    name: "POST tasks-from-action-items on B meeting (client refused)",
    method: "POST",
    path: (f) => `/api/meetings/${f.meetingB}/tasks`,
    body: () => ({ indexes: [0] }),
    // admin/member reach the service (no notes yet → 400 invalid); client 404
    expect: { admin: 400, member: 400, clientA: 404, anon: ANON },
  },
  {
    name: "GET /api/meetings/search (internal only)",
    method: "GET",
    path: () => "/api/meetings/search?q=budget",
    expect: { admin: 200, member: 200, clientA: 403, anon: ANON },
  },
  // ===== Scheduler (account-scoped; clients read own + approve via portal) =====
  {
    name: "GET posts in account B (client of A: not found)",
    method: "GET",
    path: (f) => `/api/posts?account=${f.accountB}`,
    expect: { admin: 200, member: 200, clientA: 404, anon: ANON },
  },
  {
    name: "POST post (clients cannot create)",
    method: "POST",
    path: () => "/api/posts",
    body: (f) => ({ accountId: f.accountA, channels: ["linkedin"], body: "probe" }),
    expect: { admin: 201, member: 201, clientA: 403, anon: ANON },
  },
  {
    name: "GET post in B (client of A refused)",
    method: "GET",
    path: (f) => `/api/posts/${f.postB}`,
    expect: { admin: 200, member: 200, clientA: 404, anon: ANON },
  },
  {
    name: "PATCH post in B (client of A refused)",
    method: "PATCH",
    path: (f) => `/api/posts/${f.postB}`,
    body: () => ({ body: "hacked" }),
    expect: { admin: 200, member: 200, clientA: 404, anon: ANON },
  },
  {
    name: "POST content slot (clients cannot create)",
    method: "POST",
    path: () => "/api/content-slots",
    body: (f) => ({ accountId: f.accountA, rrule: "FREQ=WEEKLY;BYDAY=TU", channels: ["instagram"] }),
    expect: { admin: 201, member: 201, clientA: 403, anon: ANON },
  },
  // ===== Intelligence (docs/08 — the whole layer is internal-only) =====
  {
    name: "GET /api/hooks (internal only)",
    method: "GET",
    path: () => "/api/hooks",
    expect: { admin: 200, member: 200, clientA: 403, anon: ANON },
  },
  {
    name: "POST hook (clients cannot create)",
    method: "POST",
    path: () => "/api/hooks",
    body: () => ({ text: "matrix probe hook", format: "question" }),
    expect: { admin: 201, member: 201, clientA: 403, anon: ANON },
  },
  {
    name: "GET /api/research (internal only)",
    method: "GET",
    path: () => "/api/research",
    expect: { admin: 200, member: 200, clientA: 403, anon: ANON },
  },
  {
    name: "GET research semantic search (internal only)",
    method: "GET",
    path: () => "/api/research/search?q=pricing",
    expect: { admin: 200, member: 200, clientA: 403, anon: ANON },
  },
  {
    name: "GET creatives in B (internal only)",
    method: "GET",
    path: (f) => `/api/creatives?account=${f.accountB}`,
    expect: { admin: 200, member: 200, clientA: 403, anon: ANON },
  },
  {
    name: "POST creative in B (client refused)",
    method: "POST",
    path: () => "/api/creatives",
    body: (f) => ({ accountId: f.accountB, platform: "meta" }),
    expect: { admin: 201, member: 201, clientA: 403, anon: ANON },
  },
  {
    name: "GET Brain for B (internal only)",
    method: "GET",
    path: (f) => `/api/brain/${f.accountB}`,
    expect: { admin: 200, member: 200, clientA: 403, anon: ANON },
  },
  {
    name: "PATCH Brain for B (client refused)",
    method: "PATCH",
    path: (f) => `/api/brain/${f.accountB}`,
    body: () => ({ offer: "matrix probe" }),
    expect: { admin: 200, member: 200, clientA: 403, anon: ANON },
  },
  {
    name: "GET Brain suggestions for B (internal only)",
    method: "GET",
    path: (f) => `/api/brain/${f.accountB}/suggestions`,
    expect: { admin: 200, member: 200, clientA: 403, anon: ANON },
  },
  {
    // roles run in order: admin decides first (200), member hits 409 decided,
    // client is refused before any state is read past the lookup
    name: "POST decide Brain suggestion in B",
    method: "POST",
    path: (f) => `/api/brain/suggestions/${f.suggestionB}`,
    body: () => ({ decision: "rejected" }),
    expect: { admin: 200, member: 409, clientA: 403, anon: ANON },
  },
  {
    // no ANTHROPIC_API_KEY in CI → internal roles reach the real call and fail
    // loudly (500); what matters here is clients/anon never reach it
    name: "POST Brain chat for B (client refused before the model call)",
    method: "POST",
    path: (f) => `/api/brain/${f.accountB}/chat`,
    body: () => ({ message: "matrix probe" }),
    expect: { admin: [200, 500], member: [200, 500], clientA: 403, anon: ANON },
  },
  // ===== Metrics (docs/09 — internal-only) =====
  {
    name: "GET metric sources in B (internal only)",
    method: "GET",
    path: (f) => `/api/metrics/sources?account=${f.accountB}`,
    expect: { admin: 200, member: 200, clientA: 403, anon: ANON },
  },
  {
    name: "POST metric source in B (client refused)",
    method: "POST",
    path: () => "/api/metrics/sources",
    body: (f) => ({ accountId: f.accountB, kind: "csv" }),
    expect: { admin: 201, member: 201, clientA: 403, anon: ANON },
  },
  {
    name: "POST CSV import to B source (client refused; idempotent for team)",
    method: "POST",
    path: (f) => `/api/metrics/sources/${f.metricSourceB}/import`,
    body: () => ({
      csv: "ad id,day,amount spent,ad name\nmx-1,2026-07-01,12.50,Matrix probe ad\n",
      mapping: { externalId: "ad id", date: "day", name: "ad name", metrics: { spend: "amount spent" } },
    }),
    expect: { admin: 201, member: 201, clientA: 403, anon: ANON },
  },
  {
    name: "GET unmatched rows in B (internal only)",
    method: "GET",
    path: (f) => `/api/metrics/unmatched?account=${f.accountB}`,
    expect: { admin: 200, member: 200, clientA: 403, anon: ANON },
  },
  {
    name: "POST link metric row in B to creative (client refused)",
    method: "POST",
    path: (f) => `/api/metrics/rows/${f.metricRowB}/link`,
    body: (f) => ({ creativeId: f.creativeB }),
    expect: { admin: 200, member: 200, clientA: 403, anon: ANON },
  },
  // ===== Onboarding (docs/10 — internal console + hardened public form) =====
  {
    name: "GET intakes for B (internal only)",
    method: "GET",
    path: (f) => `/api/onboarding/intakes?account=${f.accountB}`,
    expect: { admin: 200, member: 200, clientA: 403, anon: ANON },
  },
  {
    name: "POST intake link for B (client refused)",
    method: "POST",
    path: () => "/api/onboarding/intakes",
    body: (f) => ({ accountId: f.accountB }),
    expect: { admin: 201, member: 201, clientA: 403, anon: ANON },
  },
  {
    name: "GET onboarding templates (internal only)",
    method: "GET",
    path: () => "/api/onboarding/templates",
    expect: { admin: 200, member: 200, clientA: 403, anon: ANON },
  },
  // Public intake form: session-agnostic; valid token 200, bad token 404.
  {
    name: "GET public intake form (valid token, no session required)",
    method: "GET",
    path: (f) => `/api/onboarding/form/${f.intakeTokenB}`,
    expect: { admin: 200, member: 200, clientA: 200, anon: 200 },
  },
  {
    name: "GET public intake form bad token → 404",
    method: "GET",
    path: () => "/api/onboarding/form/nosuchtokenxxxxxxxxxxxxx",
    expect: { admin: 404, member: 404, clientA: 404, anon: 404 },
  },
  {
    // roles run in order: admin commits (201), member hits 409 already-committed
    name: "POST commit intake in B (client refused; commit-once)",
    method: "POST",
    path: (f) => `/api/onboarding/intakes/${f.intakeB}/commit`,
    body: () => ({ brain: { offer: "matrix probe offer" }, competitors: [], gapTasks: [] }),
    expect: { admin: 201, member: 409, clientA: 403, anon: ANON },
  },
  // ===== Portal (docs/11 — clients reach ONLY their own account's portal) =====
  {
    name: "GET portal home for B (client of A: not found)",
    method: "GET",
    path: (f) => `/api/portal/${f.accountB}`,
    expect: { admin: 200, member: 200, clientA: 404, anon: ANON },
  },
  {
    name: "GET portal home for A (client of A may see)",
    method: "GET",
    path: (f) => `/api/portal/${f.accountA}`,
    expect: { admin: 200, member: 200, clientA: 200, anon: ANON },
  },
  {
    name: "GET portal meetings for B (client of A: not found)",
    method: "GET",
    path: (f) => `/api/portal/${f.accountB}/meetings`,
    expect: { admin: 200, member: 200, clientA: 404, anon: ANON },
  },
  {
    // regression for the comment-read leak: version under B's review item
    name: "GET review comments on B version (client of A: not found)",
    method: "GET",
    path: (f) => `/api/review/versions/${f.reviewVersionB}/comments`,
    expect: { admin: 200, member: 200, clientA: 404, anon: ANON },
  },
  {
    // new rule: bare rejection (no suggestions) is invalid for anyone allowed
    name: "POST bare post rejection refused; cross-account client 404",
    method: "POST",
    path: (f) => `/api/posts/${f.postB}/approval`,
    body: () => ({ decision: "rejected" }),
    expect: { admin: 400, member: 400, clientA: 404, anon: ANON },
  },
  {
    name: "GET /api/search (internal only)",
    method: "GET",
    path: () => "/api/search?q=matrix",
    expect: { admin: 200, member: 200, clientA: 403, anon: ANON },
  },
  // ===== Academy (docs/16 — clients never see training or the handbook) =====
  {
    name: "GET /api/sops (internal only)",
    method: "GET",
    path: () => "/api/sops",
    expect: { admin: 200, member: 200, clientA: 403, anon: ANON },
  },
  {
    name: "POST SOP (clients cannot create)",
    method: "POST",
    path: () => "/api/sops",
    body: () => ({ title: "Matrix SOP", category: "ops", body: "# Matrix\nprobe" }),
    expect: { admin: 201, member: 201, clientA: 403, anon: ANON },
  },
  {
    name: "GET /api/courses (internal only)",
    method: "GET",
    path: () => "/api/courses",
    expect: { admin: 200, member: 200, clientA: 403, anon: ANON },
  },
  {
    name: "POST lesson into course (client refused)",
    method: "POST",
    path: () => "/api/lessons",
    body: (f) => ({ courseId: f.courseId, position: 99, title: "Matrix lesson", kind: "doc", body: "probe" }),
    expect: { admin: 201, member: 201, clientA: 403, anon: ANON },
  },
  {
    name: "GET completion matrix (admin only)",
    method: "GET",
    path: () => "/api/academy/matrix",
    expect: { admin: 200, member: 403, clientA: 403, anon: ANON },
  },
  {
    name: "POST assignment rule (client refused)",
    method: "POST",
    path: (f) => "/api/academy/assignments",
    body: (f) => ({ courseId: f.courseId, roles: ["member"] }),
    expect: { admin: 201, member: 201, clientA: 403, anon: ANON },
  },
  {
    name: "GET handbook search (internal only)",
    method: "GET",
    path: () => "/api/notebook?q=kickoff",
    expect: { admin: 200, member: 200, clientA: 403, anon: ANON },
  },
  {
    // no ANTHROPIC_API_KEY in CI: internal roles reach the model call and fail
    // loudly; clients are refused before any retrieval
    name: "POST notebook ask (client refused before the model call)",
    method: "POST",
    path: () => "/api/notebook",
    body: () => ({ question: "matrix probe" }),
    expect: { admin: [200, 500], member: [200, 500], clientA: 403, anon: ANON },
  },
  {
    name: "GET notebook gaps (internal only)",
    method: "GET",
    path: () => "/api/notebook/gaps",
    expect: { admin: 200, member: 200, clientA: 403, anon: ANON },
  },
  {
    name: "POST /api/slack/commands unconfigured → 501 (never open)",
    method: "POST",
    path: () => "/api/slack/commands",
    body: () => ({}),
    expect: { admin: 501, member: 501, clientA: 501, anon: 501 },
  },
  // ===== Password auth + paid DIY (hardening + db/008) =====
  {
    // public endpoint, identical 401 for unknown email / wrong password;
    // 429 = the per-IP limiter fired first (repeated CI runs) — also a denial
    name: "POST password login with bad creds → denied for everyone",
    method: "POST",
    path: () => "/api/auth/password-login",
    body: () => ({ email: `nobody-${Date.now()}@example.com`, password: "definitely-wrong" }),
    expect: { admin: [401, 429], member: [401, 429], clientA: [401, 429], anon: [401, 429] },
  },
  {
    name: "POST set password (signed-in only)",
    method: "POST",
    path: () => "/api/auth/password",
    body: () => ({ password: "matrix-probe-pass-1" }),
    expect: { admin: 200, member: 200, clientA: 200, anon: ANON },
  },
  {
    name: "GET /api/learn (any signed-in user)",
    method: "GET",
    path: () => "/api/learn",
    expect: { admin: 200, member: 200, clientA: 200, anon: ANON },
  },
  {
    name: "GET entitled paid course (clientA may see)",
    method: "GET",
    path: (f) => `/api/courses/${f.paidCourseEntitled}`,
    expect: { admin: 200, member: 200, clientA: 200, anon: ANON },
  },
  {
    name: "GET locked paid course (clientA: not found)",
    method: "GET",
    path: (f) => `/api/courses/${f.paidCourseLocked}`,
    expect: { admin: 200, member: 200, clientA: 404, anon: ANON },
  },
  {
    name: "GET internal course detail (client refused even with DIY access)",
    method: "GET",
    path: (f) => `/api/courses/${f.courseId}`,
    expect: { admin: 200, member: 200, clientA: 404, anon: ANON },
  },
  {
    name: "POST grant entitlement (internal only)",
    method: "POST",
    path: () => "/api/academy/entitlements",
    body: (f) => ({ courseId: f.paidCourseLocked, email: `matrix-diy-${Date.now()}@example.com` }),
    expect: { admin: 201, member: 201, clientA: 403, anon: ANON },
  },
  {
    name: "GET entitlements list (internal only)",
    method: "GET",
    path: (f) => `/api/academy/entitlements?course=${f.paidCourseEntitled}`,
    expect: { admin: 200, member: 200, clientA: 403, anon: ANON },
  },
  // ===== Stripe storefront (db/009) =====
  {
    name: "GET /api/diy/catalog (public)",
    method: "GET",
    path: () => "/api/diy/catalog",
    expect: { admin: 200, member: 200, clientA: 200, anon: 200 },
  },
  {
    name: "POST /api/diy/checkout unconfigured → 501 (never open)",
    method: "POST",
    path: (f) => "/api/diy/checkout",
    body: (f) => ({ courseId: f.paidCourseEntitled }),
    expect: { admin: 501, member: 501, clientA: 501, anon: 501 },
  },
  {
    name: "POST /api/stripe/webhook unconfigured → 501 (never open)",
    method: "POST",
    path: () => "/api/stripe/webhook",
    body: () => ({ id: "evt_probe", type: "checkout.session.completed", data: { object: {} } }),
    expect: { admin: 501, member: 501, clientA: 501, anon: 501 },
  },
  {
    name: "PATCH course price (internal only)",
    method: "PATCH",
    path: (f) => `/api/courses/${f.paidCourseLocked}`,
    body: () => ({ priceCents: 9900 }),
    expect: { admin: 200, member: 200, clientA: 403, anon: ANON },
  },
];

function matches(actual: number, expected: number | number[]): boolean {
  return Array.isArray(expected) ? expected.includes(actual) : actual === expected;
}

async function run() {
  const f = await setup();
  const roles: Role[] = ["admin", "member", "clientA", "anon"];
  let failures = 0;
  let checks = 0;

  for (const c of CASES) {
    for (const role of roles) {
      const cookie = f.cookies[role];
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (cookie) headers.cookie = cookie;
      const res = await fetch(`${APP_URL}${c.path(f)}`, {
        method: c.method,
        headers,
        body: c.body ? JSON.stringify(c.body(f)) : undefined,
        redirect: "manual",
      });
      checks++;
      const expected = c.expect[role];
      if (!matches(res.status, expected)) {
        failures++;
        console.error(
          `✗ [${role}] ${c.method} ${c.name}: got ${res.status}, expected ${JSON.stringify(expected)}`,
        );
      }
    }
  }

  await client.end();
  console.log(`\nroute-matrix: ${checks - failures}/${checks} checks passed`);
  if (failures > 0) {
    console.error(`${failures} FAILED`);
    process.exit(1);
  }
  console.log("all route-matrix assertions passed ✓");
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
