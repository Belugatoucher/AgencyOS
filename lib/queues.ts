import { Queue } from "bullmq";
import Redis from "ioredis";

// The five queues from docs/00. Week 1 wires the rails (queue defs, job_runs
// recording, health surfacing); real processors arrive with their modules.
export const QUEUE_NAMES = ["media", "transcribe", "ai", "ghl", "publish"] as const;
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
