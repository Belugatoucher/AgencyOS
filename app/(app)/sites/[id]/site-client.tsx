"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Badge, Button, Card, Input, Select } from "@/components/ui";
import { api } from "@/lib/fetcher";
import { ago, HealthDot, StageTrack, Textarea, type HealthStatus } from "../shared";

// ---------- types (mirror the service read models) ----------

type Site = {
  id: string;
  name: string;
  slug: string;
  stage: string;
  domain: string | null;
  productionUrl: string | null;
  previewUrl: string | null;
  sourceUrl: string | null;
  host: string;
  hostRef: string | null;
  repo: string;
  repoRef: string | null;
  skillPack: string;
  settings: Settings;
};
type Settings = {
  autoPropose?: boolean;
  autoOptimize?: boolean;
  runner?: "manual" | "remote";
  maxPages?: number;
  analytics?: { gsc?: { property: string }; ga4?: { propertyId: string }; ghl?: { locationId?: string; source?: string } };
};
type Action = { kind: string; label: string; priority: number; ref?: string };
type Detail = {
  site: Site;
  accountName: string;
  actions: Action[];
  health: HealthStatus;
  facts: { checks: { kind: string; status: HealthStatus; summary: string }[] };
  capabilities: {
    runners: { id: string; label: string; available: boolean }[];
    hosts: { id: string; label: string; available: boolean }[];
    proposer: { available: boolean };
  };
  skillPacks: { id: string; name: string; version?: string; enabled: boolean; reason: string | null }[];
};
type Snapshot = {
  id: string;
  sourceUrl: string;
  status: string;
  pageCount: number;
  brand: { colors?: { value: string; count: number }[]; fonts?: string[]; logoUrl?: string | null; themeColor?: string | null };
  audit: { brokenLinks?: { url: string; status: number }[]; missingMeta?: { url: string; missing: string[] }[]; thinPages?: { url: string }[]; notes?: string[] };
  error: string | null;
  createdAt: string;
};
type Design = {
  id: string;
  version: number;
  status: string;
  brief: string | null;
  tokens: { colors?: Record<string, string>; typography?: { heading: string; body: string; scale?: Record<string, string> } };
  components: { name: string; purpose: string; variants?: string[] }[];
  sitemap: { path: string; title: string; purpose: string; sections?: string[]; sourceUrls?: string[] }[];
  rationale: string | null;
  error: string | null;
  decisionNote: string | null;
  createdAt: string;
};
type Build = {
  id: string;
  kind: string;
  status: string;
  brief: string | null;
  runner: string;
  skillPack: string;
  skillPackVersion: string | null;
  branch: string | null;
  commitSha: string | null;
  previewUrl: string | null;
  summary: string | null;
  changes: { path: string; action: string; note?: string }[];
  log: { at: string; level: string; message: string }[];
  error: string | null;
  decisionNote: string | null;
  createdAt: string;
};
type Deploy = { id: string; environment: string; status: string; url: string | null; commitSha: string | null; error: string | null; createdAt: string };
type Health = {
  target: { url: string } | null;
  latest: { kind: string; status: HealthStatus; summary: string; checkedAt: string }[];
  probes: { kind: string; available: boolean }[];
};
type Analytics = {
  rows: { source: string; date: string; metrics: Record<string, number> }[];
  sources: { id: string; configured: boolean; available: boolean }[];
};

const TABS = ["Overview", "Intake", "Design", "Builds", "Deploys", "Health", "Analytics", "Settings"] as const;
type Tab = (typeof TABS)[number];

export function SiteClient({ siteId }: { siteId: string }) {
  const [tab, setTab] = useState<Tab>("Overview");
  const { data, error } = useQuery({
    queryKey: ["site", siteId],
    queryFn: () => api<Detail>(`/api/sites/${siteId}`),
    refetchInterval: 15_000,
  });

  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  if (!data) return <p className="text-sm text-muted">Loading…</p>;
  const { site } = data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Link href="/sites" className="text-xs text-muted hover:text-foreground">
          ← Sites
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <HealthDot status={data.health} />
            <h1 className="text-xl font-semibold">{site.name}</h1>
            <span className="text-sm text-muted">{data.accountName}</span>
          </div>
          <StageTrack stage={site.stage} />
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted">
          {site.productionUrl && (
            <a href={site.productionUrl} target="_blank" rel="noreferrer" className="underline">
              {site.productionUrl}
            </a>
          )}
          {site.previewUrl && (
            <a href={site.previewUrl} target="_blank" rel="noreferrer" className="underline">
              latest preview
            </a>
          )}
          {site.sourceUrl && <span>old site: {site.sourceUrl}</span>}
          <span>
            host: {site.host} · pack: {site.skillPack}
          </span>
        </div>
      </div>

      <nav className="flex gap-1 overflow-x-auto border-b border-border text-sm">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            data-testid={`site-tab-${t.toLowerCase()}`}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-1.5 ${tab === t ? "border-foreground font-medium" : "border-transparent text-muted"}`}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === "Overview" && <Overview data={data} go={setTab} />}
      {tab === "Intake" && <IntakeTab site={site} />}
      {tab === "Design" && <DesignTab site={site} proposerAvailable={data.capabilities.proposer.available} />}
      {tab === "Builds" && <BuildsTab site={site} />}
      {tab === "Deploys" && <DeploysTab site={site} />}
      {tab === "Health" && <HealthTab site={site} />}
      {tab === "Analytics" && <AnalyticsTab site={site} />}
      {tab === "Settings" && <SettingsTab data={data} />}
    </div>
  );
}

function useSiteInvalidate(siteId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["site", siteId] });
    qc.invalidateQueries({ queryKey: ["site-sub", siteId] });
    qc.invalidateQueries({ queryKey: ["sites"] });
  };
}

function ErrorLine({ error }: { error: unknown }) {
  return error ? <p className="text-xs text-destructive">{(error as Error).message}</p> : null;
}

// ---------- Overview ----------

const ACTION_TAB: Record<string, Tab> = {
  start_intake: "Intake",
  retry_intake: "Intake",
  propose_design: "Design",
  review_design: "Design",
  start_build: "Builds",
  review_build: "Builds",
  fix_build: "Builds",
  fix_deploy: "Deploys",
  fix_health: "Health",
};

function Overview({ data, go }: { data: Detail; go: (t: Tab) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card title="Next">
        <ul className="flex flex-col gap-2 text-sm">
          {data.actions.map((a, i) => (
            <li key={i} className="flex items-center justify-between gap-2">
              <span className={a.priority >= 3 ? "font-medium" : a.priority === 0 ? "text-muted" : ""}>{a.label}</span>
              {ACTION_TAB[a.kind] && (
                <Button variant="outline" onClick={() => go(ACTION_TAB[a.kind]!)}>
                  Open
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Health">
        {data.facts.checks.length === 0 ? (
          <p className="text-sm text-muted">No checks yet — they start once the site has a domain or production URL.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {data.facts.checks.map((c) => (
              <li key={c.kind} className="flex items-center gap-2">
                <HealthDot status={c.status} />
                <span className="w-14 text-xs uppercase text-muted">{c.kind}</span>
                <span>{c.summary}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------- Intake ----------

function IntakeTab({ site }: { site: Site }) {
  const invalidate = useSiteInvalidate(site.id);
  const [url, setUrl] = useState(site.sourceUrl ?? "");
  const { data: snaps } = useQuery({
    queryKey: ["site-sub", site.id, "snapshots"],
    queryFn: () => api<Snapshot[]>(`/api/sites/${site.id}/intake`),
    refetchInterval: (q) => ((q.state.data as Snapshot[] | undefined)?.some((s) => s.status === "queued" || s.status === "running") ? 4000 : false),
  });
  const start = useMutation({
    mutationFn: () => api(`/api/sites/${site.id}/intake`, { method: "POST", body: JSON.stringify({ sourceUrl: url || undefined }) }),
    onSuccess: invalidate,
  });
  const latest = snaps?.[0];

  return (
    <div className="flex flex-col gap-4">
      <Card title="Crawl the old site">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            start.mutate();
          }}
        >
          <Input className="min-w-64 flex-1" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="oldsite.com" />
          <Button type="submit" disabled={start.isPending}>
            {start.isPending ? "Starting…" : latest ? "Crawl again" : "Start intake"}
          </Button>
        </form>
        <ErrorLine error={start.error} />
      </Card>

      {latest && (
        <Card title={`Latest crawl — ${latest.status}`} actions={<span className="text-xs text-muted">{ago(latest.createdAt)}</span>}>
          {latest.status === "failed" && <p className="text-sm text-destructive">{latest.error}</p>}
          {latest.status === "done" && (
            <div className="flex flex-col gap-3 text-sm">
              <p>
                {latest.pageCount} pages from {latest.sourceUrl}
              </p>
              <div className="flex flex-wrap gap-1">
                {latest.brand.colors?.map((c) => (
                  <span key={c.value} className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs">
                    <span className="inline-block h-3 w-3 rounded-sm border border-border" style={{ background: c.value }} />
                    {c.value}
                  </span>
                ))}
              </div>
              {!!latest.brand.fonts?.length && <p className="text-xs text-muted">Fonts: {latest.brand.fonts.join(", ")}</p>}
              <AuditList audit={latest.audit} />
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function AuditList({ audit }: { audit: Snapshot["audit"] }) {
  const items = [
    { label: "Broken links", n: audit.brokenLinks?.length ?? 0 },
    { label: "Pages missing title/description/h1", n: audit.missingMeta?.length ?? 0 },
    { label: "Thin pages (<150 words)", n: audit.thinPages?.length ?? 0 },
  ];
  return (
    <div className="flex flex-col gap-1">
      {items.map((i) => (
        <div key={i.label} className="flex justify-between text-xs">
          <span className="text-muted">{i.label}</span>
          <span className={i.n ? "font-medium text-warning" : ""}>{i.n}</span>
        </div>
      ))}
      {audit.notes?.map((n) => (
        <p key={n} className="text-xs text-muted">
          {n}
        </p>
      ))}
    </div>
  );
}

// ---------- Design ----------

function DesignTab({ site, proposerAvailable }: { site: Site; proposerAvailable: boolean }) {
  const invalidate = useSiteInvalidate(site.id);
  const [brief, setBrief] = useState("");
  const { data: designs } = useQuery({
    queryKey: ["site-sub", site.id, "designs"],
    queryFn: () => api<Design[]>(`/api/sites/${site.id}/designs`),
    refetchInterval: (q) => ((q.state.data as Design[] | undefined)?.some((d) => d.status === "drafting") ? 5000 : false),
  });
  const propose = useMutation({
    mutationFn: () => api(`/api/sites/${site.id}/designs`, { method: "POST", body: JSON.stringify({ brief: brief || null }) }),
    onSuccess: () => {
      setBrief("");
      invalidate();
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <Card title="Propose a design system">
        <div className="flex flex-col gap-2">
          <Textarea rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Direction for the designer: more premium, keep the green, lead with same-day service…" />
          <div className="flex items-center gap-3">
            <Button onClick={() => propose.mutate()} disabled={propose.isPending || !proposerAvailable}>
              {propose.isPending ? "Queuing…" : "Propose"}
            </Button>
            {!proposerAvailable && <span className="text-xs text-muted">Needs ANTHROPIC_API_KEY on the server.</span>}
          </div>
          <ErrorLine error={propose.error} />
        </div>
      </Card>
      {designs?.map((d) => <DesignCard key={d.id} design={d} onChange={invalidate} />)}
    </div>
  );
}

function DesignCard({ design, onChange }: { design: Design; onChange: () => void }) {
  const [note, setNote] = useState("");
  const decide = useMutation({
    mutationFn: (decision: "approve" | "reject") =>
      api(`/api/sites/designs/${design.id}/decision`, { method: "POST", body: JSON.stringify({ decision, note: note || null }) }),
    onSuccess: onChange,
  });
  const open = design.status === "proposed" || design.status === "approved";

  return (
    <Card title={`Design v${design.version}`} actions={<Badge>{design.status}</Badge>}>
      {design.status === "drafting" && <p className="text-sm text-muted">Drafting from the crawl…</p>}
      {design.status === "failed" && <p className="text-sm text-destructive">{design.error}</p>}
      {design.brief && <p className="mb-2 text-xs text-muted">Brief: {design.brief}</p>}
      {open && (
        <details open={design.status === "proposed"} className="flex flex-col gap-3 text-sm">
          <summary className="cursor-pointer text-xs text-muted">Tokens, components, sitemap</summary>
          <div className="mt-2 flex flex-wrap gap-1">
            {Object.entries(design.tokens.colors ?? {}).map(([name, hex]) => (
              <span key={name} className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs">
                <span className="inline-block h-3 w-3 rounded-sm border border-border" style={{ background: hex }} />
                {name}
              </span>
            ))}
          </div>
          {design.tokens.typography && (
            <p className="mt-2 text-xs">
              Headings <b>{design.tokens.typography.heading}</b> · Body <b>{design.tokens.typography.body}</b>
            </p>
          )}
          <h3 className="mt-3 text-xs font-semibold uppercase text-muted">Sitemap</h3>
          <ul className="flex flex-col gap-1">
            {design.sitemap.map((p) => (
              <li key={p.path} className="text-xs">
                <span className="font-mono">{p.path}</span> — {p.title}
                <span className="text-muted"> · {p.sections?.join(" → ")}</span>
              </li>
            ))}
          </ul>
          <h3 className="mt-3 text-xs font-semibold uppercase text-muted">Components</h3>
          <p className="text-xs">{design.components.map((c) => c.name).join(" · ")}</p>
          {design.rationale && <p className="mt-3 whitespace-pre-wrap text-sm">{design.rationale}</p>}
        </details>
      )}
      {design.decisionNote && <p className="mt-2 text-xs text-muted">Note: {design.decisionNote}</p>}
      {design.status === "proposed" && (
        <div className="mt-3 flex flex-col gap-2">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (required to reject — the next proposal reads it)" />
          <div className="flex gap-2">
            <Button onClick={() => decide.mutate("approve")} disabled={decide.isPending}>
              Approve
            </Button>
            <Button variant="outline" onClick={() => decide.mutate("reject")} disabled={decide.isPending || !note}>
              Reject
            </Button>
          </div>
          <ErrorLine error={decide.error} />
        </div>
      )}
    </Card>
  );
}

// ---------- Builds ----------

function BuildsTab({ site }: { site: Site }) {
  const invalidate = useSiteInvalidate(site.id);
  const [kind, setKind] = useState<"initial" | "change" | "optimize">(site.stage === "live" ? "change" : "initial");
  const [brief, setBrief] = useState("");
  const { data: builds } = useQuery({
    queryKey: ["site-sub", site.id, "builds"],
    queryFn: () => api<Build[]>(`/api/sites/${site.id}/builds`),
    refetchInterval: 10_000,
  });
  const request = useMutation({
    mutationFn: () => api(`/api/sites/${site.id}/builds`, { method: "POST", body: JSON.stringify({ kind, brief: brief || null }) }),
    onSuccess: () => {
      setBrief("");
      invalidate();
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <Card title="Request a build">
        <div className="flex flex-col gap-2">
          <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="initial">Initial build (from the approved design)</option>
            <option value="change">Change (live site)</option>
            <option value="optimize">Optimize (evidence-driven, live site)</option>
          </Select>
          <Textarea rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="What should the agent do?" />
          <div>
            <Button onClick={() => request.mutate()} disabled={request.isPending}>
              {request.isPending ? "Queuing…" : "Request build"}
            </Button>
          </div>
          <ErrorLine error={request.error} />
        </div>
      </Card>
      {builds?.map((b) => <BuildCard key={b.id} build={b} onChange={invalidate} />)}
    </div>
  );
}

function BuildCard({ build, onChange }: { build: Build; onChange: () => void }) {
  const [note, setNote] = useState("");
  const decide = useMutation({
    mutationFn: (decision: "approve" | "reject") =>
      api(`/api/sites/builds/${build.id}/decision`, { method: "POST", body: JSON.stringify({ decision, note: note || null }) }),
    onSuccess: onChange,
  });
  const cancel = useMutation({ mutationFn: () => api(`/api/sites/builds/${build.id}/cancel`, { method: "POST", body: "{}" }), onSuccess: onChange });
  const manualPending = build.runner === "manual" && build.status === "running";

  return (
    <Card
      title={`${build.kind} build · ${ago(build.createdAt)}`}
      actions={
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">
            {build.runner} · {build.skillPack}@{build.skillPackVersion ?? "?"}
          </span>
          <Badge>{build.status.replace("_", " ")}</Badge>
        </div>
      }
    >
      <div className="flex flex-col gap-2 text-sm">
        {build.brief && <p className="text-xs text-muted">Brief: {build.brief}</p>}
        {build.error && <p className="text-xs text-destructive">{build.error}</p>}
        {build.summary && <p className="whitespace-pre-wrap">{build.summary}</p>}
        {build.previewUrl && (
          <a className="text-xs underline" href={build.previewUrl} target="_blank" rel="noreferrer">
            Open preview
          </a>
        )}
        {(build.branch || build.commitSha) && (
          <p className="font-mono text-xs text-muted">
            {build.branch} {build.commitSha?.slice(0, 7)}
          </p>
        )}
        {build.changes.length > 0 && (
          <details>
            <summary className="cursor-pointer text-xs text-muted">{build.changes.length} file changes</summary>
            <ul className="mt-1 font-mono text-xs">
              {build.changes.map((c) => (
                <li key={c.path}>
                  {c.action[0]} {c.path}
                </li>
              ))}
            </ul>
          </details>
        )}
        {manualPending && build.log[0] && (
          <pre className="whitespace-pre-wrap rounded bg-background p-2 text-xs">{build.log[0].message}</pre>
        )}
        {manualPending && <ReportForm buildId={build.id} onDone={onChange} />}
        {build.status === "awaiting_review" && (
          <div className="flex flex-col gap-2">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (required to reject)" />
            <div className="flex gap-2">
              <Button onClick={() => decide.mutate("approve")} disabled={decide.isPending}>
                Approve &amp; deploy to production
              </Button>
              <Button variant="outline" onClick={() => decide.mutate("reject")} disabled={decide.isPending || !note}>
                Reject
              </Button>
            </div>
            <ErrorLine error={decide.error} />
          </div>
        )}
        {(build.status === "queued" || build.status === "running") && (
          <div>
            <Button variant="outline" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
              Cancel build
            </Button>
            <ErrorLine error={cancel.error} />
          </div>
        )}
      </div>
    </Card>
  );
}

function ReportForm({ buildId, onDone }: { buildId: string; onDone: () => void }) {
  const [f, setF] = useState({ previewUrl: "", branch: "", commitSha: "", summary: "" });
  const report = useMutation({
    mutationFn: (ok: boolean) =>
      api(`/api/sites/builds/${buildId}/report`, {
        method: "POST",
        body: JSON.stringify({
          ok,
          previewUrl: f.previewUrl || null,
          branch: f.branch || null,
          commitSha: f.commitSha || null,
          summary: f.summary || (ok ? "Reported manually" : "Run failed"),
          error: ok ? undefined : f.summary || "Run failed",
        }),
      }),
    onSuccess: onDone,
  });
  return (
    <div className="flex flex-col gap-2 rounded border border-border p-2">
      <span className="text-xs font-medium">Report result</span>
      <Input value={f.previewUrl} onChange={(e) => setF({ ...f, previewUrl: e.target.value })} placeholder="Preview URL" />
      <div className="flex gap-2">
        <Input className="flex-1" value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })} placeholder="Branch" />
        <Input className="flex-1" value={f.commitSha} onChange={(e) => setF({ ...f, commitSha: e.target.value })} placeholder="Commit SHA" />
      </div>
      <Textarea rows={3} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} placeholder="What changed" />
      <div className="flex gap-2">
        <Button onClick={() => report.mutate(true)} disabled={report.isPending || !f.previewUrl}>
          Submit for review
        </Button>
        <Button variant="outline" onClick={() => report.mutate(false)} disabled={report.isPending}>
          Mark failed
        </Button>
      </div>
      <ErrorLine error={report.error} />
    </div>
  );
}

// ---------- Deploys ----------

function DeploysTab({ site }: { site: Site }) {
  const invalidate = useSiteInvalidate(site.id);
  const { data: deploys } = useQuery({
    queryKey: ["site-sub", site.id, "deploys"],
    queryFn: () => api<Deploy[]>(`/api/sites/${site.id}/deploys`),
    refetchInterval: 10_000,
  });
  const rollback = useMutation({
    mutationFn: (id: string) => api(`/api/sites/deploys/${id}/rollback`, { method: "POST", body: "{}" }),
    onSuccess: invalidate,
  });
  const currentProd = deploys?.find((d) => d.environment === "production" && d.status === "ready");

  return (
    <Card title="Deploys">
      {!deploys?.length && <p className="text-sm text-muted">No deploys yet.</p>}
      <table className="w-full text-sm">
        <tbody>
          {deploys?.map((d) => (
            <tr key={d.id} className="border-t border-border">
              <td className="py-1.5 text-xs text-muted">{ago(d.createdAt)}</td>
              <td className="py-1.5">
                <Badge>{d.environment}</Badge>
              </td>
              <td className="py-1.5 text-xs">{d.status}</td>
              <td className="py-1.5 text-xs">
                {d.url ? (
                  <a href={d.url} target="_blank" rel="noreferrer" className="underline">
                    {d.url.replace(/^https?:\/\//, "")}
                  </a>
                ) : (
                  <span className="text-destructive">{d.error}</span>
                )}
              </td>
              <td className="py-1.5 text-right">
                {d.environment === "production" && d.status === "ready" && d.id !== currentProd?.id && (
                  <Button variant="outline" onClick={() => confirm("Roll production back to this deploy?") && rollback.mutate(d.id)}>
                    Roll back here
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ErrorLine error={rollback.error} />
    </Card>
  );
}

// ---------- Health ----------

function HealthTab({ site }: { site: Site }) {
  const invalidate = useSiteInvalidate(site.id);
  const { data } = useQuery({ queryKey: ["site-sub", site.id, "health"], queryFn: () => api<Health>(`/api/sites/${site.id}/health`) });
  const run = useMutation({ mutationFn: () => api(`/api/sites/${site.id}/health`, { method: "POST", body: "{}" }), onSuccess: () => setTimeout(invalidate, 8000) });

  return (
    <Card
      title="Health"
      actions={
        <Button variant="outline" onClick={() => run.mutate()} disabled={run.isPending || !data?.target}>
          Run checks now
        </Button>
      }
    >
      {!data?.target && <p className="text-sm text-muted">Add a domain or production URL in Settings to start monitoring.</p>}
      {data?.target && <p className="mb-2 text-xs text-muted">Checking {data.target.url} every 15 minutes while live.</p>}
      <ul className="flex flex-col gap-2 text-sm">
        {data?.probes.map((p) => {
          const latest = data.latest.find((l) => l.kind === p.kind);
          return (
            <li key={p.kind} className="flex items-center gap-2">
              <HealthDot status={latest?.status ?? "unknown"} />
              <span className="w-14 text-xs uppercase text-muted">{p.kind}</span>
              <span className="flex-1">{latest ? latest.summary : p.available ? "No result yet" : "Not set up yet"}</span>
              {latest && <span className="text-xs text-muted">{ago(latest.checkedAt)}</span>}
            </li>
          );
        })}
      </ul>
      <ErrorLine error={run.error} />
    </Card>
  );
}

// ---------- Analytics ----------

const SOURCE_LABEL: Record<string, string> = { gsc: "Search Console", ga4: "GA4", ghl: "GHL leads" };

function AnalyticsTab({ site }: { site: Site }) {
  const [days, setDays] = useState(28);
  const { data } = useQuery({
    queryKey: ["site-sub", site.id, "analytics", days],
    queryFn: () => api<Analytics>(`/api/sites/${site.id}/analytics?days=${days}`),
  });
  const totals = new Map<string, Record<string, number>>();
  for (const r of data?.rows ?? []) {
    const t = totals.get(r.source) ?? {};
    for (const [k, v] of Object.entries(r.metrics)) if (typeof v === "number") t[k] = (t[k] ?? 0) + v;
    totals.set(r.source, t);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
          <option value="7">7 days</option>
          <option value="28">28 days</option>
          <option value="90">90 days</option>
        </Select>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {data?.sources.map((s) => (
          <Card key={s.id} title={SOURCE_LABEL[s.id] ?? s.id}>
            {!s.available ? (
              <p className="text-xs text-muted">Adapter not wired yet.</p>
            ) : !s.configured ? (
              <p className="text-xs text-muted">Add its property id in Settings.</p>
            ) : (
              <dl className="grid grid-cols-2 gap-1 text-sm">
                {Object.entries(totals.get(s.id) ?? {}).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-xs text-muted">{k}</dt>
                    <dd className="text-right">{Math.round(v * 100) / 100}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

// ---------- Settings ----------

function SettingsTab({ data }: { data: Detail }) {
  const { site } = data;
  const invalidate = useSiteInvalidate(site.id);
  const [f, setF] = useState({
    name: site.name,
    domain: site.domain ?? "",
    productionUrl: site.productionUrl ?? "",
    host: site.host,
    hostRef: site.hostRef ?? "",
    repoRef: site.repoRef ?? "",
    skillPack: site.skillPack,
    runner: site.settings.runner ?? "",
    autoPropose: site.settings.autoPropose !== false,
    autoOptimize: site.settings.autoOptimize === true,
    gsc: site.settings.analytics?.gsc?.property ?? "",
    ga4: site.settings.analytics?.ga4?.propertyId ?? "",
  });
  const save = useMutation({
    mutationFn: () =>
      api(`/api/sites/${site.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: f.name,
          domain: f.domain || null,
          productionUrl: f.productionUrl || null,
          host: f.host,
          hostRef: f.hostRef || null,
          repoRef: f.repoRef || null,
          skillPack: f.skillPack,
          settings: {
            ...(f.runner ? { runner: f.runner } : {}),
            autoPropose: f.autoPropose,
            autoOptimize: f.autoOptimize,
            analytics: {
              ...(f.gsc ? { gsc: { property: f.gsc } } : {}),
              ...(f.ga4 ? { ga4: { propertyId: f.ga4 } } : {}),
            },
          },
        }),
      }),
    onSuccess: invalidate,
  });
  const setStage = useMutation({
    mutationFn: (stage: string) => api(`/api/sites/${site.id}`, { method: "PATCH", body: JSON.stringify({ stage }) }),
    onSuccess: invalidate,
  });
  const field = (label: string, key: keyof typeof f, placeholder = "") => (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      <Input value={String(f[key])} onChange={(e) => setF({ ...f, [key]: e.target.value })} placeholder={placeholder} />
    </label>
  );

  return (
    <div className="flex flex-col gap-4">
      <Card title="Site">
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          {field("Name", "name")}
          {field("Production domain", "domain", "example.com")}
          {field("Production URL", "productionUrl", "https://example.com")}
          {field("Repo (owner/name)", "repoRef", "vngrd/client-site")}
          <label className="flex flex-col gap-1 text-xs text-muted">
            Host
            <Select value={f.host} onChange={(e) => setF({ ...f, host: e.target.value })}>
              {data.capabilities.hosts.map((h) => (
                <option key={h.id} value={h.id} disabled={!h.available && h.id !== site.host}>
                  {h.label}
                  {h.available ? "" : " (not wired yet)"}
                </option>
              ))}
            </Select>
          </label>
          {field("Host project", "hostRef")}
          <label className="flex flex-col gap-1 text-xs text-muted">
            Skill pack
            <Select value={f.skillPack} onChange={(e) => setF({ ...f, skillPack: e.target.value })}>
              {data.skillPacks.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.enabled}>
                  {p.name}
                  {p.version ? ` v${p.version}` : ""}
                  {p.enabled ? "" : ` — ${p.reason ?? "disabled"}`}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Build runner
            <Select value={f.runner} onChange={(e) => setF({ ...f, runner: e.target.value })}>
              <option value="">Default (remote if configured, else manual)</option>
              {data.capabilities.runners.map((r) => (
                <option key={r.id} value={r.id} disabled={!r.available}>
                  {r.label}
                  {r.available ? "" : " (not configured)"}
                </option>
              ))}
            </Select>
          </label>
          {field("Search Console property", "gsc", "sc-domain:example.com")}
          {field("GA4 property id", "ga4", "123456789")}
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={f.autoPropose} onChange={(e) => setF({ ...f, autoPropose: e.target.checked })} />
            Draft a design as soon as a crawl finishes
          </label>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={f.autoOptimize} onChange={(e) => setF({ ...f, autoOptimize: e.target.checked })} />
            Weekly optimize build (Mondays, needs approval)
          </label>
          <div className="flex items-center gap-3 sm:col-span-2">
            <Button type="submit" disabled={save.isPending}>
              Save
            </Button>
            {save.isSuccess && <span className="text-xs text-success">Saved</span>}
            <ErrorLine error={save.error} />
          </div>
        </form>
      </Card>
      <Card title="Status">
        <div className="flex flex-wrap gap-2">
          {site.stage === "paused" || site.stage === "archived" ? (
            <Button variant="outline" onClick={() => setStage.mutate("intake")}>
              Resume
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setStage.mutate("paused")}>
              Pause (stops checks + optimize runs)
            </Button>
          )}
          {site.stage !== "archived" && (
            <Button variant="danger" onClick={() => confirm("Archive this site?") && setStage.mutate("archived")}>
              Archive
            </Button>
          )}
        </div>
        <ErrorLine error={setStage.error} />
      </Card>
    </div>
  );
}
