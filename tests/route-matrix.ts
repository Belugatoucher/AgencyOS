import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import {
  accounts,
  leads,
  memberships,
  pipelines,
  sessions,
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

  return {
    accountA: a!.id,
    accountB: b!.id,
    taskAVisible: taskAVisible!.id,
    taskAHidden: taskAHidden!.id,
    taskB: taskB!.id,
    pipelineB: pipelineB!.id,
    leadB: leadB!.id,
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
