import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// ===== Spine (db/schema.sql) =====

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  ghlLocationId: text("ghl_location_id").unique(),
  timezone: text("timezone").notNull().default("America/New_York"),
  brand: jsonb("brand").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"), // active|paused|done
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull().default(""),
  role: text("role").notNull().default("member"), // admin|member|client
  // Auth.js requirement; set on first successful magic-link login.
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    userId: uuid("user_id").notNull().references(() => users.id),
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    role: text("role").notNull().default("client"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.accountId] })],
);

// ===== Files (shared by Review, Assets, Notes) =====

export const files = pgTable("files", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  r2Key: text("r2_key").notNull().unique(),
  filename: text("filename").notNull(),
  mime: text("mime").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  checksum: text("checksum"),
  uploadedBy: uuid("uploaded_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ===== Tasks (db/schema.sql, docs/04) =====

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").references(() => accounts.id),
    projectId: uuid("project_id").references(() => projects.id),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("todo"), // backlog|todo|in_progress|in_review|done
    priority: text("priority").notNull().default("normal"), // low|normal|high|urgent
    assigneeId: uuid("assignee_id").references(() => users.id),
    dueAt: timestamp("due_at", { withTimezone: true }),
    estimateMinutes: integer("estimate_minutes"),
    source: text("source").notNull().default("manual"), // manual|meeting|review|recurring|asset
    sourceId: uuid("source_id"),
    clientVisible: boolean("client_visible").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tasks_assignee").on(t.assigneeId, t.status, t.dueAt)],
);

export const taskChecklist = pgTable("task_checklist", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").notNull().references(() => tasks.id),
  label: text("label").notNull(),
  done: boolean("done").notNull().default(false),
  position: integer("position").notNull(),
});

export const taskComments = pgTable("task_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").notNull().references(() => tasks.id),
  parentId: uuid("parent_id"), // threaded once; self-reference enforced in SQL
  authorId: uuid("author_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const recurringRules = pgTable("recurring_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  rrule: text("rrule").notNull(),
  taskTemplate: jsonb("task_template").notNull(), // {title, accountId?, projectId?, assigneeId?, ...}
  nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
  active: boolean("active").notNull().default(true),
});

// ===== Ops =====

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    kind: text("kind").notNull(),
    body: jsonb("body").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_user").on(t.userId, t.readAt)],
);

export const jobRuns = pgTable("job_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  queue: text("queue").notNull(),
  job: text("job").notNull(),
  status: text("status").notNull(), // ok|failed|retrying
  payloadHash: text("payload_hash"),
  error: text("error"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ===== Auth.js support tables =====
// DECISION: Auth.js (magic-link email provider, database sessions) needs
// sessions + verification_tokens and an email_verified column on users.
// Added here and to db/schema.sql in the same commit (CLAUDE.md rule 1).
// No oauth accounts table: email-only provider via a custom adapter avoids a
// name collision with the domain `accounts` table.

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

export type Account = typeof accounts.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type User = typeof users.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type FileRecord = typeof files.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type JobRun = typeof jobRuns.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type TaskChecklistItem = typeof taskChecklist.$inferSelect;
export type TaskComment = typeof taskComments.$inferSelect;
export type RecurringRule = typeof recurringRules.$inferSelect;
