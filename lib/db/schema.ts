import { sql } from "drizzle-orm";
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
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// ===== Spine (db/schema.sql) =====

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  ghlLocationId: text("ghl_location_id").unique(),
  timezone: text("timezone").notNull().default("America/New_York"),
  brand: jsonb("brand").notNull().default({}),
  // Leads (db/006-leads-manual.sql)
  leadMode: text("lead_mode").notNull().default("manual"), // manual|ghl
  portalLeads: text("portal_leads").notNull().default("off"), // off|summary|full
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

// ===== Leads (db/schema.sql + 006-leads-manual.sql, docs/02) =====

export const pipelines = pgTable("pipelines", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
  intakeToken: text("intake_token").unique(), // public form endpoint; null = disabled
  ghlPipelineId: text("ghl_pipeline_id"), // set in ghl mode
});

export const stages = pgTable("stages", {
  id: uuid("id").primaryKey().defaultRandom(),
  pipelineId: uuid("pipeline_id").notNull().references(() => pipelines.id),
  name: text("name").notNull(),
  color: text("color"),
  position: integer("position").notNull(),
  isWon: boolean("is_won").notNull().default(false),
  isLost: boolean("is_lost").notNull().default(false),
  ghlStageId: text("ghl_stage_id"),
});

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").references(() => accounts.id), // nullable: agency's own pipeline
    // shared (synced) fields
    name: text("name"),
    email: text("email"),
    phone: text("phone"),
    company: text("company"),
    // legacy GHL text ids retained for ghl mirror; local uuids are authoritative
    pipelineId: text("pipeline_id"),
    stageId: text("stage_id"),
    pipelineUuid: uuid("pipeline_uuid").references(() => pipelines.id),
    stageUuid: uuid("stage_uuid").references(() => stages.id),
    valueCents: bigint("value_cents", { mode: "number" }),
    status: text("status"),
    tags: text("tags").array(),
    source: text("source"),
    links: jsonb("links").notNull().default([]), // website, socials
    // internal-only fields
    ownerId: uuid("owner_id").references(() => users.id),
    score: integer("score"),
    scoreRationale: text("score_rationale"),
    nextActionAt: timestamp("next_action_at", { withTimezone: true }),
    internalNotes: text("internal_notes"),
    clientHidden: boolean("client_hidden").notNull().default(false),
    ghlUpdatedAt: timestamp("ghl_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("leads_board").on(t.accountId, t.pipelineUuid, t.stageUuid)],
);

export const leadActivities = pgTable("lead_activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").notNull().references(() => leads.id),
  kind: text("kind").notNull(), // note|stage_change|call|conflict|ghl_event
  body: jsonb("body").notNull(),
  actorId: uuid("actor_id").references(() => users.id),
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

// ===== Assets (db/schema.sql, docs/05) =====

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    projectId: uuid("project_id").references(() => projects.id),
    fileId: uuid("file_id").notNull().references(() => files.id),
    type: text("type").notNull(), // logo|photo|video|raw|font|doc|export
    status: text("status").notNull().default("draft"), // draft|in_review|approved|archived
    assigneeId: uuid("assignee_id").references(() => users.id),
    tags: text("tags").array().notNull().default(sql`'{}'`),
    rightsNote: text("rights_note"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    supersededBy: uuid("superseded_by"),
    thumbKey: text("thumb_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("assets_browse").on(t.accountId, t.type, t.status)],
);

export const collections = pgTable("collections", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  name: text("name").notNull(),
  isBrandKit: boolean("is_brand_kit").notNull().default(false),
  isDropbox: boolean("is_dropbox").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const collectionAssets = pgTable(
  "collection_assets",
  {
    collectionId: uuid("collection_id").notNull().references(() => collections.id),
    assetId: uuid("asset_id").notNull().references(() => assets.id),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.assetId] })],
);

export const assetUsage = pgTable("asset_usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetId: uuid("asset_id").notNull().references(() => assets.id),
  usedIn: text("used_in").notNull(), // post|review_version|campaign
  usedInId: uuid("used_in_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ===== Review (db/schema.sql, docs/01) =====

export const reviewItems = pgTable("review_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  projectId: uuid("project_id").references(() => projects.id),
  title: text("title").notNull(),
  clientVisible: boolean("client_visible").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const reviewVersions = pgTable(
  "review_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id").notNull().references(() => reviewItems.id),
    versionNo: integer("version_no").notNull(),
    fileId: uuid("file_id").notNull().references(() => files.id),
    hlsKey: text("hls_key"), // null until transcoded
    thumbKey: text("thumb_key"),
    spriteKey: text("sprite_key"),
    status: text("status").notNull().default("processing"), // processing|ready|failed
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("review_versions_item_no").on(t.itemId, t.versionNo)],
);

export const reviewComments = pgTable("review_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  versionId: uuid("version_id").notNull().references(() => reviewVersions.id),
  parentId: uuid("parent_id"),
  authorId: uuid("author_id").references(() => users.id),
  guestName: text("guest_name"),
  shareLinkId: uuid("share_link_id"),
  timestampMs: integer("timestamp_ms"),
  timestampEndMs: integer("timestamp_end_ms"),
  kind: text("kind").notNull().default("note"), // note|change
  changeStatus: text("change_status"), // open|accepted|declined|done (kind=change)
  suggestion: jsonb("suggestion"), // {current, proposed}
  region: jsonb("region"), // {x,y,w,h}
  drawing: jsonb("drawing"), // SVG path data
  body: text("body").notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reviewApprovals = pgTable("review_approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  versionId: uuid("version_id").notNull().references(() => reviewVersions.id),
  decision: text("decision").notNull(), // approved|changes_requested
  decidedBy: uuid("decided_by").references(() => users.id),
  guestName: text("guest_name"),
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shareLinks = pgTable("share_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  token: text("token").notNull().unique(),
  kind: text("kind").notNull(), // review_item|collection
  targetId: uuid("target_id").notNull(),
  pin: text("pin"),
  canComment: boolean("can_comment").notNull().default(true),
  latestOnly: boolean("latest_only").notNull().default(false),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ===== Notes (db/schema.sql, docs/03) =====

export const meetings = pgTable("meetings", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").references(() => accounts.id),
  projectId: uuid("project_id").references(() => projects.id),
  leadId: uuid("lead_id").references(() => leads.id),
  title: text("title").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  attendees: jsonb("attendees").notNull().default([]), // [{name,email?}]
  audioFileId: uuid("audio_file_id").references(() => files.id),
  retention: text("retention").notNull().default("keep"), // keep|90d|transcript_only
  clientVisible: boolean("client_visible").notNull().default(false),
  status: text("status").notNull().default("uploaded"), // uploaded|transcribing|summarizing|ready|failed
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// DECISION: the base schema.sql defines a stored tsvector generated column +
// GIN index on transcripts. Drizzle-kit doesn't model generated tsvector cleanly,
// so we compute to_tsvector at query time for now (correct, fine for current
// volume). Add the stored column + GIN index as a follow-up migration at scale.
export const transcripts = pgTable("transcripts", {
  meetingId: uuid("meeting_id").primaryKey().references(() => meetings.id),
  segments: jsonb("segments").notNull(), // [{start_ms,end_ms,speaker,text}]
  speakers: jsonb("speakers").notNull().default({}), // {"SPEAKER_00":"Dana"}
});

export const meetingNotes = pgTable("meeting_notes", {
  meetingId: uuid("meeting_id").primaryKey().references(() => meetings.id),
  summary: text("summary"),
  decisions: jsonb("decisions").default([]),
  actionItems: jsonb("action_items").default([]), // [{text,owner_guess,due_guess,task_id?}]
  followups: jsonb("followups").default([]),
  raw: jsonb("raw"),
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
export type Pipeline = typeof pipelines.$inferSelect;
export type Stage = typeof stages.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type LeadActivity = typeof leadActivities.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type Collection = typeof collections.$inferSelect;
export type AssetUsage = typeof assetUsage.$inferSelect;
export type ReviewItem = typeof reviewItems.$inferSelect;
export type ReviewVersion = typeof reviewVersions.$inferSelect;
export type ReviewComment = typeof reviewComments.$inferSelect;
export type ReviewApproval = typeof reviewApprovals.$inferSelect;
export type ShareLink = typeof shareLinks.$inferSelect;
export type Meeting = typeof meetings.$inferSelect;
export type Transcript = typeof transcripts.$inferSelect;
export type MeetingNotes = typeof meetingNotes.$inferSelect;
