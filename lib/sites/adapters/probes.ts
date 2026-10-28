import { connect } from "node:tls";
import { expiryStatus } from "@/lib/sites/pipeline";
import type { CheckKind, CheckResult, HealthProbe } from "@/lib/sites/types";
import { assertPublicUrl, safeFetch } from "./safe-fetch";

// Health probes (docs/18). uptime + ssl are real and dependency-free; vitals
// uses PageSpeed Insights when PAGESPEED_API_KEY is set. links / forms /
// domain are declared so the dashboard can show them as "not set up" and the
// next session only has to fill in run().

const SLOW_MS = 3000;

export const uptimeProbe: HealthProbe = {
  kind: "uptime",
  available: () => true,
  async run({ url }) {
    try {
      const res = await safeFetch(url, { timeoutMs: 15_000, maxBytes: 200_000 });
      const detail = { status: res.status, ms: res.ms, finalUrl: res.url };
      if (res.status >= 500 || res.status === 0) return r("uptime", "fail", `Down — HTTP ${res.status}`, detail);
      if (res.status >= 400) return r("uptime", "fail", `HTTP ${res.status}`, detail);
      if (res.ms > SLOW_MS) return r("uptime", "warn", `Up but slow (${(res.ms / 1000).toFixed(1)}s)`, detail);
      return r("uptime", "ok", `Up — ${res.ms} ms`, detail);
    } catch (e) {
      return r("uptime", "fail", `Unreachable — ${msg(e)}`, {});
    }
  },
};

export const sslProbe: HealthProbe = {
  kind: "ssl",
  available: () => true,
  async run({ url, hostname }) {
    if (!url.startsWith("https://")) return r("ssl", "fail", "Site is not served over HTTPS", {});
    try {
      await assertPublicUrl(url);
      const cert = await peerCertificate(hostname);
      const validTo = new Date(cert.valid_to);
      const daysLeft = Math.floor((validTo.getTime() - Date.now()) / 86_400_000);
      const detail = { validTo: validTo.toISOString(), daysLeft, issuer: cert.issuer?.O ?? cert.issuer?.CN ?? null, authorized: cert.authorized };
      if (!cert.authorized) return r("ssl", "fail", `Certificate not trusted (${cert.authError ?? "unknown"})`, detail);
      const status = expiryStatus(daysLeft);
      return r("ssl", status, status === "ok" ? `Valid for ${daysLeft} days` : `Expires in ${daysLeft} days`, detail);
    } catch (e) {
      return r("ssl", "fail", `TLS check failed — ${msg(e)}`, {});
    }
  },
};

function peerCertificate(
  hostname: string,
): Promise<{ valid_to: string; issuer?: { O?: string; CN?: string }; authorized: boolean; authError?: string }> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: hostname, port: 443, servername: hostname, timeout: 10_000, rejectUnauthorized: false }, () => {
      const cert = socket.getPeerCertificate();
      const out = {
        valid_to: cert.valid_to,
        issuer: cert.issuer as { O?: string; CN?: string } | undefined,
        authorized: socket.authorized,
        authError: socket.authorizationError ? String(socket.authorizationError) : undefined,
      };
      socket.end();
      if (!cert.valid_to) reject(new Error("no certificate presented"));
      else resolve(out);
    });
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("timed out"));
    });
    socket.on("error", reject);
  });
}

/** Core Web Vitals via PageSpeed Insights (mobile). Field data when Google has it, lab otherwise. */
export const vitalsProbe: HealthProbe = {
  kind: "vitals",
  available: () => Boolean(process.env.PAGESPEED_API_KEY),
  async run({ url }) {
    const api = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
    api.searchParams.set("url", url);
    api.searchParams.set("strategy", "mobile");
    api.searchParams.set("category", "performance");
    api.searchParams.set("key", process.env.PAGESPEED_API_KEY!);
    try {
      const res = await fetch(api, { signal: AbortSignal.timeout(90_000) });
      if (!res.ok) return r("vitals", "unknown", `PageSpeed returned ${res.status}`, {});
      const j = (await res.json()) as {
        loadingExperience?: { overall_category?: string; metrics?: Record<string, { percentile?: number; category?: string }> };
        lighthouseResult?: { categories?: { performance?: { score?: number } } };
      };
      const field = j.loadingExperience?.metrics ?? {};
      const score = Math.round((j.lighthouseResult?.categories?.performance?.score ?? 0) * 100);
      const detail = {
        score,
        lcpMs: field.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null,
        cls: field.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile != null ? field.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : null,
        inpMs: field.INTERACTION_TO_NEXT_PAINT?.percentile ?? null,
        fieldCategory: j.loadingExperience?.overall_category ?? null,
      };
      const cat = detail.fieldCategory;
      const status = cat === "SLOW" || score < 50 ? "fail" : cat === "AVERAGE" || score < 80 ? "warn" : "ok";
      return r("vitals", status, `Performance ${score}/100${cat ? ` · field ${cat.toLowerCase()}` : ""}`, detail);
    } catch (e) {
      return r("vitals", "unknown", `PageSpeed check failed — ${msg(e)}`, {});
    }
  },
};

function notYet(kind: CheckKind, todo: string): HealthProbe {
  return {
    kind,
    available: () => false,
    async run() {
      return r(kind, "unknown", `Not set up yet — ${todo}`, {});
    },
  };
}

// TODO(docs/18): crawl the live site with fetchCrawler (small cap) and report 4xx/5xx internal links.
export const linksProbe = notYet("links", "broken-link crawl");
// TODO(docs/18): submit a tagged test lead through the site form, then confirm the GHL contact appears.
export const formsProbe = notYet("forms", "test submission → GHL contact check");
// TODO(docs/18): RDAP lookup (https://rdap.org/domain/{domain}) → expiration event → expiryStatus().
export const domainProbe = notYet("domain", "RDAP expiry lookup");

export const ALL_PROBES: HealthProbe[] = [uptimeProbe, sslProbe, vitalsProbe, linksProbe, formsProbe, domainProbe];

function r(kind: CheckKind, status: CheckResult["status"], summary: string, detail: Record<string, unknown>): CheckResult {
  return { kind, status, summary, detail };
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message.slice(0, 200) : "error";
}
