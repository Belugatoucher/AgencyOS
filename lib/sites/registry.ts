import { claudeProposer } from "./adapters/claude-proposer";
import { fetchCrawler } from "./adapters/fetch-crawler";
import { cloudflarePagesHost, manualHost, noRepo, vercelHost } from "./adapters/hosts";
import { manualRunner, remoteRunner, remoteRunnerConfigured } from "./adapters/runners";
import type { BuildRunner, Crawler, DesignProposer, HostProvider, RepoProvider } from "./types";

// Which implementation each site gets (docs/18). The one place to change
// when an adapter lands — services ask here and never import adapters.

export const HOSTS = ["manual", "cloudflare_pages", "vercel", "ghl", "external"] as const;
export type HostId = (typeof HOSTS)[number];
export const RUNNERS = ["manual", "remote"] as const;
export type RunnerId = (typeof RUNNERS)[number];

export function crawlerFor(): Crawler {
  // DECISION: one crawler for now; a Playwright crawler for JS-rendered sites
  // slots in here keyed on site.settings.crawler.
  return fetchCrawler;
}

export function proposerFor(): DesignProposer {
  return claudeProposer;
}

export function hostFor(host: string): HostProvider {
  switch (host) {
    case "cloudflare_pages":
      return cloudflarePagesHost;
    case "vercel":
      return vercelHost;
    // ghl + external: hosted outside our control; we only record and monitor.
    default:
      return manualHost;
  }
}

export function repoFor(repo: string): RepoProvider {
  void repo; // TODO(docs/18): "github" → GitHub provider
  return noRepo;
}

/** Runner choice: explicit site setting, else remote when configured, else manual. */
export function runnerFor(preferred: string | undefined): BuildRunner {
  if (preferred === "manual") return manualRunner;
  return remoteRunnerConfigured() ? remoteRunner : manualRunner;
}

export function runnerById(id: string): BuildRunner {
  return id === "remote" ? remoteRunner : manualRunner;
}

/** For the Settings tab: what's actually usable in this environment. */
export function capabilities() {
  return {
    runners: [
      { id: "manual", label: manualRunner.label, available: true },
      { id: "remote", label: remoteRunner.label, available: remoteRunnerConfigured() },
    ],
    hosts: [
      { id: "manual", label: "Manual", available: true },
      { id: "cloudflare_pages", label: "Cloudflare Pages", available: false },
      { id: "vercel", label: "Vercel", available: false },
      { id: "ghl", label: "GHL (monitor only)", available: true },
      { id: "external", label: "External (monitor only)", available: true },
    ],
    proposer: { id: claudeProposer.id, available: Boolean(process.env.ANTHROPIC_API_KEY) },
  };
}
