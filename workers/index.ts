import { createHash } from "node:crypto";
import { Worker, type Job } from "bullmq";
import { db } from "../lib/db";
import { jobRuns } from "../lib/db/schema";
import { bullConnection, QUEUE_NAMES, type QueueName } from "../lib/queues";

// Worker skeleton: every queue gets a Worker whose processors dispatch by job
// name and always record a job_runs row (docs/00 — failures surface in
// /admin/health, they never vanish). Module processors register here as they land.

type Processor = (job: Job) => Promise<unknown>;

const processors: Record<QueueName, Record<string, Processor>> = {
  media: {},
  transcribe: {},
  ai: {
    // trivially verifiable job so the pipeline can be exercised end-to-end
    async heartbeat() {
      return { ok: true, at: new Date().toISOString() };
    },
  },
  ghl: {},
  publish: {},
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
      const handler = processors[queueName][job.name];
      if (!handler) throw new Error(`No processor for ${queueName}/${job.name}`);
      const started = Date.now();
      try {
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

async function shutdown() {
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
