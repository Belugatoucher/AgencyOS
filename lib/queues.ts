import { Queue } from "bullmq";
import Redis from "ioredis";

// The five queues from docs/00 plus `cron` (see DECISION 2026-07-17): a queue
// for time-driven internal jobs (recurring task spawning, daily digests) that
// don't fit media/ai/ghl/publish. Week 1 wired the rails; modules add processors.
export const QUEUE_NAMES = ["media", "transcribe", "ai", "ghl", "publish", "cron"] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

export function bullConnection(): Redis {
  return new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null, // BullMQ requirement
  });
}

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, {
      connection: bullConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
    queues.set(name, q);
  }
  return q;
}
