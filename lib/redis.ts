import Redis from "ioredis";

const url = process.env.REDIS_URL ?? "redis://localhost:6379";

// One shared connection for app-side commands (rate limits, notifications).
// BullMQ queues/workers create their own connections (maxRetriesPerRequest rules).
let client: Redis | null = null;

export function redis(): Redis {
  if (!client) client = new Redis(url, { lazyConnect: false });
  return client;
}
