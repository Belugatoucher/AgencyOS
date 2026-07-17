import { redis } from "./redis";

// Fixed-window counter in Redis. Used by magic-link requests (audit item 3)
// and later by share-link PIN attempts (audit item 1) and public endpoints.
export async function rateLimit(opts: {
  key: string;
  limit: number;
  windowSeconds: number;
}): Promise<{ ok: boolean; remaining: number }> {
  const key = `rl:${opts.key}`;
  const r = redis();
  const count = await r.incr(key);
  if (count === 1) await r.expire(key, opts.windowSeconds);
  return { ok: count <= opts.limit, remaining: Math.max(0, opts.limit - count) };
}
