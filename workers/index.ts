import { createHash } from "node:crypto";
import { Worker, type Job } from "bullmq";
import { db } from "../lib/db";
import { jobRuns } from "../lib/db/schema";
import { bullConnection, getQueue, QUEUE_NAMES, type QueueName } from "../lib/queues";
import { runDueRecurringRules } from "../lib/services/recurring";
import { sendDailyDigests } from "../lib/services/digest";
import { applyLeadScore, scoreLead } from "../lib/services/lead-scoring";
import { processAssetThumbnail, processLessonMedia, processReviewVersion } from "../lib/media/jobs";
import { flagExpiringAssets } from "../lib/services/asset-rights";
import { transcribeLesson, transcribeMeeting } from "../lib/transcribe";
import { embedSop, sopStalenessSweep } from "../lib/services/sops";
import { embedLesson } from "../lib/services/academy";
import { notebookGapReport } from "../lib/services/notebook";
import { completedSession, fulfillStripeSession } from "../lib/services/diy";
import { applyNotes, generateNotes } from "../lib/services/meeting-notes";
import { enqueueDuePosts, publishPost } from "../lib/scheduler/publish";
import { embedResearchDoc } from "../lib/services/research";
import { rollupAllAccounts, unmatchedSpendDigest } from "../lib/services/metrics";
import { sendClientDigests } from "../lib/services/portal-digest";

// Worker skeleton: every queue gets a Worker whose processors dispatch by job
// name and always record a job_runs row (docs/00 — failures surface in
// /admin/health, they never vanish). Module processors register here as they land.

type Processor = (job: Job) => Promise<unknown>;

const processors: Record<QueueName, Record<string, Processor>> = {
  media: {
    // Asset image/video thumbnail (docs/05)
    async "asset-thumbnail"(job) {
      const { assetId } = job.data as { assetId: string };
      return processAssetThumbnail(assetId);
    },
    // Review version: poster + sprite + HLS ladder (docs/01)
    async "review-transcode"(job) {
      const { versionId } = job.data as { versionId: string };
      return processReviewVersion(versionId);
    },
    // Lesson video: HLS via the same rail, then whisper (docs/16)
    async "lesson-media"(job) {
      const { lessonId } = job.data as { lessonId: string };
      return processLessonMedia(lessonId);
    },
  },
  transcribe: {
    // faster-whisper + pyannote → diarized segments, then enqueue notes (docs/03)
    async "transcribe-meeting"(job) {
      const { meetingId } = job.data as { meetingId: string };
      return transcribeMeeting(meetingId);
    },
    // Lesson transcript → kb embed (docs/16)
    async "transcribe-lesson"(job) {
      const { lessonId } = job.data as { lessonId: string };
      return transcribeLesson(lessonId);
    },
  },
  ai: {
    // trivially verifiable job so the pipeline can be exercised end-to-end
    async heartbeat() {
      return { ok: true, at: new Date().toISOString() };
    },
    // Lead scoring (docs/02): score via Claude, then write score + rationale
    // and append the JSON as a note. Human gates remain (never moves a stage).
    async "score-lead"(job) {
      const { leadId } = job.data as { leadId: string };
      const score = await scoreLead(leadId);
      await applyLeadScore(leadId, score);
      return { leadId, score: score.score, band: score.band };
    },
    // Meeting notes from a diarized transcript (docs/03)
    async "meeting-notes"(job) {
      const { meetingId } = job.data as { meetingId: string };
      const notes = await generateNotes(meetingId);
      await applyNotes(meetingId, notes);
      return { meetingId, actionItems: notes.action_items.length };
    },
    // Research doc → chunks + embeddings for retrieval (docs/08)
    async "embed-research"(job) {
      const { docId } = job.data as { docId: string };
      return embedResearchDoc(docId);
    },
    // Published SOP → heading-anchored kb chunks (docs/16)
    async "embed-sop"(job) {
      const { sopId } = job.data as { sopId: string };
      return embedSop(sopId);
    },
    // Lesson transcript → timestamped kb chunks (docs/16)
    async "embed-lesson"(job) {
      const { lessonId } = job.data as { lessonId: string };
      return embedLesson(lessonId);
    },
  },
  ghl: {},
  publish: {
    // Deliver one post via the active adapter (manual default, GHL behind creds)
    async "publish-post"(job) {
      const { postId } = job.data as { postId: string };
      return publishPost(postId);
    },
  },
  cron: {
    // Spawn tasks for recurring rules whose next_run_at has passed.
    async "spawn-recurring"() {
      return runDueRecurringRules();
    },
    // Per-member daily digest (due today / overdue / awaiting review).
    async "daily-digest"() {
      return sendDailyDigests();
    },
    // Weekly rights-expiry sweep (docs/05): flag assets expiring in 30 days
    // and any expired asset still marked approved.
    async "asset-rights-sweep"() {
      return flagExpiringAssets();
    },
    // Enqueue due scheduled posts for publishing (docs/06)
    async "publish-sweep"() {
      return enqueueDuePosts();
    },
    // Nightly rollup (docs/09): metric_rows → creatives.metrics + is_winning
    async "metrics-rollup"() {
      return rollupAllAccounts();
    },
    // Weekly unmatched-spend digest (docs/09)
    async "unmatched-spend-digest"() {
      return unmatchedSpendDigest();
    },
    // Weekly client portal digest (docs/11)
    async "client-digest"() {
      return sendClientDigests();
    },
    // SOP staleness sweep (docs/16): overdue published SOPs → needs_review
    async "sop-staleness-sweep"() {
      return sopStalenessSweep();
    },
    // Weekly "SOPs we're missing" report from Notebook gaps (docs/16)
    async "notebook-gap-report"() {
      return notebookGapReport();
    },
  },
  billing: {
    // Stripe fulfillment (db/009): grant entitlement + record purchase.
    // Idempotent on the session id, so BullMQ retries are safe.
    async "stripe-entitle"(job) {
      const session = completedSession.parse(job.data);
      return fulfillStripeSession(session);
    },
  },
};

function payloadHash(data: unknown): string {
  return createHash("sha256").update(JSON.stringify(data ?? {})).digest("hex").slice(0, 16);
}

async function recordRun(
  queue: string,
  job: Job,
  status: "ok" | "failed" | "retrying",
  error: string | null,
  durationMs: number,
) {
  await db.insert(jobRuns).values({
    queue,
    job: job.name,
    status,
    payloadHash: payloadHash(job.data),
    error,
    durationMs,
  });
}

function startWorker(queueName: QueueName): Worker {
  const worker = new Worker(
    queueName,
    async (job) => {
      const started = Date.now();
      try {
        const handler = processors[queueName][job.name];
        if (!handler) throw new Error(`No processor for ${queueName}/${job.name}`);
        const result = await handler(job);
        await recordRun(queueName, job, "ok", null, Date.now() - started);
        return result;
      } catch (e) {
        const willRetry = job.attemptsMade + 1 < (job.opts.attempts ?? 1);
        await recordRun(
          queueName,
          job,
          willRetry ? "retrying" : "failed",
          e instanceof Error ? e.message : String(e),
          Date.now() - started,
        );
        throw e;
      }
    },
    { connection: bullConnection(), concurrency: 4 },
  );
  worker.on("error", (e) => console.error(`[worker:${queueName}]`, e));
  return worker;
}

const workers = QUEUE_NAMES.map(startWorker);
console.log(`[worker] listening on queues: ${QUEUE_NAMES.join(", ")}`);

// Register repeatable cron jobs. BullMQ dedupes by jobId, so re-running the
// worker won't stack duplicate schedules.
async function registerSchedules() {
  const cron = getQueue("cron");
  await cron.add(
    "spawn-recurring",
    {},
    { repeat: { pattern: "*/5 * * * *" }, jobId: "spawn-recurring" }, // every 5 min
  );
  await cron.add(
    "daily-digest",
    {},
    { repeat: { pattern: "0 8 * * *" }, jobId: "daily-digest" }, // 08:00 daily
  );
  await cron.add(
    "asset-rights-sweep",
    {},
    { repeat: { pattern: "0 7 * * 1" }, jobId: "asset-rights-sweep" }, // Mon 07:00
  );
  await cron.add(
    "publish-sweep",
    {},
    { repeat: { pattern: "*/2 * * * *" }, jobId: "publish-sweep" }, // every 2 min
  );
  await cron.add(
    "metrics-rollup",
    {},
    { repeat: { pattern: "30 2 * * *" }, jobId: "metrics-rollup" }, // nightly 02:30
  );
  await cron.add(
    "unmatched-spend-digest",
    {},
    { repeat: { pattern: "0 9 * * 1" }, jobId: "unmatched-spend-digest" }, // Mon 09:00
  );
  await cron.add(
    "client-digest",
    {},
    { repeat: { pattern: "30 8 * * 5" }, jobId: "client-digest" }, // Fri 08:30 (docs/11 weekly)
  );
  await cron.add(
    "sop-staleness-sweep",
    {},
    { repeat: { pattern: "0 6 * * *" }, jobId: "sop-staleness-sweep" }, // daily 06:00 (docs/16)
  );
  await cron.add(
    "notebook-gap-report",
    {},
    { repeat: { pattern: "0 9 * * 3" }, jobId: "notebook-gap-report" }, // Wed 09:00 (docs/16 weekly)
  );
  console.log("[worker] cron schedules registered");
}
registerSchedules().catch((e) => console.error("[worker] schedule registration failed", e));

async function shutdown() {
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
