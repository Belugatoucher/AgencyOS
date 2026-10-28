import { lookup } from "node:dns/promises";
import { isPrivateHost } from "@/lib/sites/pipeline";

// SSRF-safe fetch for the crawler and probes: the target is user-entered, so
// every hop (including redirects) must resolve to a public address. Redirects
// are followed by hand so each Location is re-checked.

export class BlockedUrlError extends Error {}

export async function assertPublicUrl(raw: string): Promise<URL> {
  const u = new URL(raw);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new BlockedUrlError(`Blocked scheme ${u.protocol}`);
  if (isPrivateHost(u.hostname)) throw new BlockedUrlError(`Blocked host ${u.hostname}`);
  const addrs = await lookup(u.hostname, { all: true, verbatim: true });
  for (const a of addrs) {
    if (isPrivateHost(a.address.includes(":") ? `[${a.address}]` : a.address)) {
      throw new BlockedUrlError(`${u.hostname} resolves to a private address`);
    }
  }
  return u;
}

export type SafeResponse = { url: string; status: number; headers: Headers; body: string; ms: number };

export async function safeFetch(
  raw: string,
  opts: { timeoutMs: number; maxBytes?: number; method?: "GET" | "HEAD"; maxRedirects?: number },
): Promise<SafeResponse> {
  const started = Date.now();
  let current = raw;
  for (let hop = 0; hop <= (opts.maxRedirects ?? 4); hop++) {
    await assertPublicUrl(current);
    const res = await fetch(current, {
      method: opts.method ?? "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs),
      headers: { "user-agent": "AgencyOS-SiteBot/1.0 (+site intake & monitoring)", accept: "text/html,*/*;q=0.8" },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, current).toString();
      continue;
    }
    const body = opts.method === "HEAD" ? "" : await readCapped(res, opts.maxBytes ?? 2_000_000);
    return { url: current, status: res.status, headers: res.headers, body, ms: Date.now() - started };
  }
  throw new Error(`Too many redirects from ${raw}`);
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
