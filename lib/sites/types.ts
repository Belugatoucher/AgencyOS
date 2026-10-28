import { z } from "zod";

// Sites adapter contracts (docs/18 "Pluggable parts"). Services only ever talk
// to these interfaces; lib/sites/registry.ts decides which implementation a
// site gets. Adding Cloudflare Pages, a GitHub repo provider, or a different
// agent runner means adding an implementation here — services don't change.

// ---------- Intake ----------

export type CrawledPage = {
  url: string;
  status: number;
  title: string | null;
  description: string | null;
  h1: string | null;
  headings: string[]; // h2/h3 text, capped
  wordCount: number;
  text: string; // visible text, capped (feeds the design proposer)
  images: { src: string; alt: string | null }[];
  links: string[]; // same-origin absolute URLs
  canonical: string | null;
};

export type BrandSignals = {
  colors: { value: string; count: number }[]; // hex, most frequent first
  fonts: string[];
  logoUrl: string | null;
  faviconUrl: string | null;
  themeColor: string | null;
};

export type IntakeAudit = {
  brokenLinks: { url: string; status: number; from: string }[];
  missingMeta: { url: string; missing: ("title" | "description" | "h1")[] }[];
  thinPages: { url: string; wordCount: number }[];
  notes: string[];
};

export type SiteSnapshotResult = {
  pages: CrawledPage[];
  brand: BrandSignals;
  audit: IntakeAudit;
};

export type CrawlOptions = { maxPages: number; timeoutMs: number };

export interface Crawler {
  readonly id: string;
  crawl(sourceUrl: string, opts: CrawlOptions): Promise<SiteSnapshotResult>;
}

// ---------- Design system ----------
// Zod-gated because it comes back from a model (CLAUDE.md rule 6).

export const designTokens = z.object({
  colors: z
    .record(z.string().max(40), z.string().max(40))
    .describe("semantic name → hex, e.g. primary, primary-foreground, background, muted, accent"),
  typography: z.object({
    heading: z.string().max(80),
    body: z.string().max(80),
    scale: z.record(z.string().max(20), z.string().max(40)).default({}), // h1 → "3rem/1.1"
  }),
  spacing: z.record(z.string().max(20), z.string().max(20)).default({}),
  radii: z.record(z.string().max(20), z.string().max(20)).default({}),
  shadows: z.record(z.string().max(20), z.string().max(120)).default({}),
});

export const designComponent = z.object({
  name: z.string().max(60),
  purpose: z.string().max(300),
  variants: z.array(z.string().max(60)).max(12).default([]),
});

export const sitemapEntry = z.object({
  path: z.string().max(200),
  title: z.string().max(120),
  purpose: z.string().max(300),
  sections: z.array(z.string().max(120)).max(20).default([]),
  sourceUrls: z.array(z.string().max(500)).max(10).default([]), // old pages whose content moves here
});

export const designSystemDraft = z.object({
  tokens: designTokens,
  components: z.array(designComponent).max(40),
  sitemap: z.array(sitemapEntry).max(60),
  rationale: z.string().max(4000),
});
export type DesignSystemDraft = z.infer<typeof designSystemDraft>;

export type ProposalInput = {
  siteName: string;
  accountName: string;
  brief: string | null;
  snapshot: SiteSnapshotResult | null; // null when starting from scratch
  brand: Record<string, unknown>; // accounts.brand
  previous: DesignSystemDraft | null; // last rejected/superseded proposal + note, for iteration
  previousNote: string | null;
};

export interface DesignProposer {
  readonly id: string;
  propose(input: ProposalInput): Promise<DesignSystemDraft>;
}

// ---------- Builds ----------

export type BuildContext = {
  buildId: string;
  site: {
    id: string;
    slug: string;
    name: string;
    domain: string | null;
    repoRef: string | null;
    hostRef: string | null;
  };
  kind: "initial" | "change" | "optimize";
  brief: string | null;
  designSystem: DesignSystemDraft | null;
  snapshot: SiteSnapshotResult | null;
  skillPack: { id: string; version: string; phase: SkillPhase; root: string; entry: string };
  /** recent analytics/health so optimize runs have evidence to work from */
  evidence: Record<string, unknown>;
};

export type BuildStartResult =
  /** the runner finished synchronously (rare) */
  | { state: "finished"; outcome: BuildOutcome }
  /** the runner is working; status() is polled / a webhook reports back */
  | { state: "running"; runRef: string }
  /** a person has to do the work and report back through the UI */
  | { state: "manual"; instructions: string };

export type BuildOutcome = {
  ok: boolean;
  branch: string | null;
  commitSha: string | null;
  previewUrl: string | null;
  summary: string;
  changes: { path: string; action: "add" | "modify" | "delete"; note?: string }[];
  log: { at: string; level: "info" | "warn" | "error"; message: string }[];
  error?: string;
};

export interface BuildRunner {
  readonly id: string;
  readonly label: string;
  start(ctx: BuildContext): Promise<BuildStartResult>;
  status(runRef: string): Promise<{ done: false } | { done: true; outcome: BuildOutcome }>;
  cancel(runRef: string): Promise<void>;
}

// ---------- Skill packs ----------

export const SKILL_PHASES = ["build", "optimize", "audit"] as const;
export type SkillPhase = (typeof SKILL_PHASES)[number];

export const skillPackManifest = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().max(80),
  version: z.string().max(40),
  description: z.string().max(500),
  enabled: z.boolean().default(true),
  disabledReason: z.string().max(300).optional(),
  source: z.object({ kind: z.enum(["local", "git"]), url: z.string().max(300).optional() }).default({ kind: "local" }),
  /** phase → entry file (relative to the pack folder) */
  phases: z.record(z.enum(SKILL_PHASES), z.string().max(200)),
  /** what the site repo must look like for this pack (framework, host) */
  expects: z.object({ framework: z.string().max(40).optional(), host: z.array(z.string()).optional() }).default({}),
});
export type SkillPackManifest = z.infer<typeof skillPackManifest>;

// ---------- Repo + hosting ----------

export interface RepoProvider {
  readonly id: string;
  ensureRepo(site: { slug: string; repoRef: string | null }): Promise<{ repoRef: string }>;
  openChange(input: { repoRef: string; branch: string; title: string; body: string }): Promise<{ ref: string; url: string | null }>;
  mergeChange(input: { repoRef: string; ref: string }): Promise<{ commitSha: string }>;
}

export type DeployRequest = {
  site: { id: string; slug: string; hostRef: string | null; domain: string | null };
  environment: "preview" | "production";
  commitSha: string | null;
  branch: string | null;
  /** preview URL the runner already produced, if any (manual host uses it) */
  knownUrl: string | null;
};

export type DeployState =
  | { status: "building"; providerRef: string; url: string | null }
  | { status: "ready"; providerRef: string | null; url: string | null }
  | { status: "failed"; providerRef: string | null; error: string };

export interface HostProvider {
  readonly id: string;
  readonly label: string;
  ensureProject(site: { slug: string; hostRef: string | null }): Promise<{ hostRef: string | null }>;
  deploy(req: DeployRequest): Promise<DeployState>;
  getDeploy(providerRef: string): Promise<DeployState>;
  rollback(input: { site: DeployRequest["site"]; toProviderRef: string | null }): Promise<DeployState>;
  /** verify + parse an inbound webhook; null when this provider has no webhook */
  parseWebhook?(req: { headers: Headers; body: string }): Promise<{ providerRef: string; state: DeployState } | null>;
}

// ---------- Health + analytics ----------

export const CHECK_KINDS = ["uptime", "ssl", "domain", "vitals", "links", "forms"] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];
export type CheckStatus = "ok" | "warn" | "fail" | "unknown";

export type CheckResult = {
  kind: CheckKind;
  status: CheckStatus;
  summary: string;
  detail: Record<string, unknown>;
};

export interface HealthProbe {
  readonly kind: CheckKind;
  /** false = not configured; the sweep skips it and the UI says why */
  available(): boolean;
  run(target: { url: string; hostname: string; siteId: string }): Promise<CheckResult>;
}

export const METRIC_SOURCES = ["gsc", "ga4", "ghl"] as const;
export type MetricSource = (typeof METRIC_SOURCES)[number];

export interface AnalyticsSource {
  readonly id: MetricSource;
  available(site: { id: string; settings: Record<string, unknown> }): boolean;
  pullDaily(site: { id: string; domain: string | null; settings: Record<string, unknown> }, date: string): Promise<Record<string, number>>;
}
