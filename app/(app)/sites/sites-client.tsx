"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, Card, Input, Select } from "@/components/ui";
import { api } from "@/lib/fetcher";
import { ago, HealthDot, StageTrack, type HealthStatus } from "./shared";

type Account = { id: string; name: string };
type Row = {
  site: {
    id: string;
    name: string;
    stage: string;
    domain: string | null;
    productionUrl: string | null;
    previewUrl: string | null;
    host: string;
    accountId: string;
  };
  accountName: string;
  health: HealthStatus;
  checks: { kind: string; status: HealthStatus; summary: string }[];
  next: { kind: string; label: string; priority: number };
  lastDeployAt: string | null;
  clicks28d: number | null;
  leads28d: number | null;
};

const FILTERS = ["all", "needs you", "in progress", "live"] as const;

export function SitesClient() {
  const qc = useQueryClient();
  const router = useRouter();
  const [accountId, setAccountId] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [showNew, setShowNew] = useState(false);

  const { data: accounts } = useQuery({ queryKey: ["accounts"], queryFn: () => api<Account[]>("/api/accounts") });
  const { data: rows, isLoading, error } = useQuery({
    queryKey: ["sites", accountId],
    queryFn: () => api<Row[]>(`/api/sites${accountId ? `?account=${accountId}` : ""}`),
    refetchInterval: 30_000,
  });

  const visible = (rows ?? []).filter((r) => {
    if (filter === "needs you") return r.next.priority >= 3;
    if (filter === "in progress") return !["live", "paused", "archived"].includes(r.site.stage);
    if (filter === "live") return r.site.stage === "live";
    return r.site.stage !== "archived";
  });

  const counts = {
    live: rows?.filter((r) => r.site.stage === "live").length ?? 0,
    needs: rows?.filter((r) => r.next.priority >= 3).length ?? 0,
    failing: rows?.filter((r) => r.health === "fail").length ?? 0,
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Sites</h1>
        <div className="flex items-center gap-2">
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} data-testid="sites-account">
            <option value="">All clients</option>
            {accounts?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          <Link href="/sites/grader" className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-background">
            Grader
          </Link>
          <Button onClick={() => setShowNew((v) => !v)} data-testid="sites-new">
            {showNew ? "Close" : "New site"}
          </Button>
        </div>
      </div>

      {showNew && (
        <NewSite
          accounts={accounts ?? []}
          defaultAccount={accountId}
          onCreated={(id) => {
            qc.invalidateQueries({ queryKey: ["sites"] });
            router.push(`/sites/${id}`);
          }}
        />
      )}

      <div className="grid grid-cols-3 gap-3 text-sm">
        <Stat label="Live" value={counts.live} />
        <Stat label="Waiting on you" value={counts.needs} tone={counts.needs ? "warn" : undefined} />
        <Stat label="Failing checks" value={counts.failing} tone={counts.failing ? "fail" : undefined} />
      </div>

      <nav className="flex gap-1 border-b border-border text-sm">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`-mb-px border-b-2 px-3 py-1.5 capitalize ${filter === f ? "border-foreground font-medium" : "border-transparent text-muted"}`}
          >
            {f}
          </button>
        ))}
      </nav>

      {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
      {isLoading && <p className="text-sm text-muted">Loading…</p>}
      {!isLoading && visible.length === 0 && (
        <p className="text-sm text-muted">{rows?.length ? "Nothing matches this filter." : "No sites yet. Start with “New site” and the old site's address."}</p>
      )}

      <ul className="flex flex-col gap-2">
        {visible.map((r) => (
          <li key={r.site.id}>
            <Link
              href={`/sites/${r.site.id}`}
              className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 hover:border-foreground/30 sm:flex-row sm:items-center sm:justify-between"
              data-testid="site-row"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex items-center gap-2">
                  <HealthDot status={r.health} />
                  <span className="truncate font-medium">{r.site.name}</span>
                  <span className="truncate text-xs text-muted">{r.accountName}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <StageTrack stage={r.site.stage} />
                  {r.site.domain && <span>{r.site.domain}</span>}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className={r.next.priority >= 3 ? "font-medium text-warning" : "text-muted"}>{r.next.label}</span>
                <span className="text-muted">deploy {ago(r.lastDeployAt)}</span>
                {r.clicks28d != null && <Badge>{r.clicks28d} clicks/28d</Badge>}
                {r.leads28d != null && <Badge>{r.leads28d} leads/28d</Badge>}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" | "fail" }) {
  const color = tone === "fail" ? "text-destructive" : tone === "warn" ? "text-warning" : "";
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

function NewSite({ accounts, defaultAccount, onCreated }: { accounts: Account[]; defaultAccount: string; onCreated: (id: string) => void }) {
  const [form, setForm] = useState({ accountId: defaultAccount, name: "", sourceUrl: "", domain: "" });
  const [startCrawl, setStartCrawl] = useState(true);
  const create = useMutation({
    mutationFn: async () => {
      const site = await api<{ id: string }>("/api/sites", {
        method: "POST",
        body: JSON.stringify({
          accountId: form.accountId,
          name: form.name,
          sourceUrl: form.sourceUrl || null,
          domain: form.domain || null,
        }),
      });
      if (startCrawl && form.sourceUrl) {
        await api(`/api/sites/${site.id}/intake`, { method: "POST", body: JSON.stringify({}) });
      }
      return site;
    },
    onSuccess: (site) => onCreated(site.id),
  });

  return (
    <Card title="New site">
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <label className="flex flex-col gap-1 text-xs text-muted">
          Client
          <Select required value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>
            <option value="">Select…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Site name
          <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Granite Oak main site" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Old site address
          <Input value={form.sourceUrl} onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })} placeholder="graniteoakwaste.com" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Production domain (optional)
          <Input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="graniteoakwaste.com" />
        </label>
        <label className="flex items-center gap-2 text-xs text-muted sm:col-span-2">
          <input type="checkbox" checked={startCrawl} onChange={(e) => setStartCrawl(e.target.checked)} />
          Crawl the old site now, then draft a design system
        </label>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={create.isPending || !form.accountId || !form.name}>
            {create.isPending ? "Creating…" : "Create site"}
          </Button>
          {create.error && <span className="text-xs text-destructive">{(create.error as Error).message}</span>}
        </div>
      </form>
    </Card>
  );
}
