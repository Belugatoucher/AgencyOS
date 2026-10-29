"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Badge, Button, Card, Input } from "@/components/ui";
import { api } from "@/lib/fetcher";

type Fix = { id: string; label: string; fix: string };
type Report = {
  id: string;
  token: string;
  link: string;
  source: "public" | "internal" | "bulk";
  batchId: string | null;
  url: string;
  businessName: string | null;
  city: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  leadId: string | null;
  utm: { source?: string; campaign?: string };
  status: "queued" | "running" | "done" | "failed";
  score: number | null;
  letter: string | null;
  result: { topFixes?: Fix[]; summary?: string };
  maps: { top3Share: number; competitor: { name: string } | null } | null;
  error: string | null;
  views: number;
  lastViewedAt: string | null;
  createdAt: string;
};
type Caps = { psi: boolean; maps: boolean; pipeline: boolean; ghlWebhook: boolean; bookingUrl: string | null };

const FILTERS = [
  { id: "", label: "All" },
  { id: "public", label: "Inbound leads" },
  { id: "internal", label: "Prospects" },
  { id: "bulk", label: "Bulk batches" },
] as const;

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = "", ...rest } = props;
  return <textarea className={`rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent ${className}`} {...rest} />;
}

const LETTER_CLS: Record<string, string> = { A: "text-success", B: "text-success", C: "text-warning", D: "text-destructive", F: "text-destructive" };

function ago(iso: string | null) {
  if (!iso) return "—";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

/** Short outreach message for a prospect report. Copy goes to the clipboard; Ryan sends it himself. */
function pitch(r: Report) {
  const biz = r.businessName ?? r.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const fix = r.result.topFixes?.[0]?.label?.toLowerCase();
  const rival = r.maps?.competitor?.name;
  return [
    `Hey — I ran ${biz}'s website through our grader and it scored ${r.score}/100.`,
    fix ? `The biggest thing costing you calls: ${fix}.` : null,
    rival ? `On Google Maps, ${rival} is showing up ahead of you in most of town.` : null,
    `Here's the full report (free, no strings): ${r.link}`,
    `Happy to walk through it in 10 minutes if it's useful.`,
  ]
    .filter(Boolean)
    .join(" ");
}

export function GraderClient() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>("");
  const [batch, setBatch] = useState<string>("");
  const key = ["grader", filter, batch];
  const { data, error } = useQuery({
    queryKey: key,
    queryFn: () => api<{ reports: Report[]; capabilities: Caps }>(`/api/sites/grader?${new URLSearchParams({ ...(filter ? { source: filter } : {}), ...(batch ? { batch } : {}) })}`),
    refetchInterval: (q) => ((q.state.data as { reports: Report[] } | undefined)?.reports.some((r) => r.status === "queued" || r.status === "running") ? 5000 : 30_000),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["grader"] });
  const reports = data?.reports ?? [];
  const caps = data?.capabilities;

  const stats = {
    leads: reports.filter((r) => r.source === "public").length,
    opened: reports.filter((r) => r.source !== "public" && r.views > 0).length,
    sent: reports.filter((r) => r.source !== "public").length,
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link href="/sites" className="text-xs text-muted hover:text-foreground">
          ← Sites
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">Website grader</h1>
          <a href="/grade" target="_blank" rel="noreferrer" className="text-sm text-accent hover:underline">
            Open the public grader ↗
          </a>
        </div>
        <p className="text-sm text-muted">Grade prospects, send them the report, and see who opens it. Inbound grades from the public page land here and in your lead pipeline.</p>
      </div>

      {caps && (!caps.psi || !caps.maps || !caps.pipeline || (!caps.ghlWebhook && !caps.bookingUrl)) && (
        <Card title="Setup">
          <ul className="flex flex-col gap-1 text-sm">
            <Setup ok={caps.psi} label="Google speed test" todo="Set PAGESPEED_API_KEY (free from Google Cloud). Without it, speed is estimated from response time." />
            <Setup ok={caps.maps} label="Google Maps grid" todo="Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD. About $0.06–$0.20 per report." />
            <Setup ok={caps.pipeline} label="Inbound leads → pipeline" todo="Set GRADER_PIPELINE_ID to the agency pipeline grader leads should land in." />
            <Setup ok={caps.ghlWebhook} label="GHL follow-up" todo="Set GRADER_GHL_WEBHOOK_URL to your GHL workflow's inbound webhook (see the offer playbook)." />
            <Setup ok={Boolean(caps.bookingUrl)} label="Booking link on reports" todo="Set GRADER_BOOKING_URL to your GHL calendar link." />
          </ul>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-3 text-sm">
        <Stat label="Inbound leads" value={stats.leads} />
        <Stat label="Prospect reports" value={stats.sent} />
        <Stat label="Prospects who opened" value={stats.opened} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <SingleForm onDone={refresh} />
        <BulkForm
          onDone={(b) => {
            setFilter("bulk");
            setBatch(b);
            refresh();
          }}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav className="flex gap-1 border-b border-border text-sm">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => {
                setFilter(f.id);
                setBatch("");
              }}
              className={`-mb-px border-b-2 px-3 py-1.5 ${filter === f.id ? "border-foreground font-medium" : "border-transparent text-muted"}`}
            >
              {f.label}
            </button>
          ))}
        </nav>
        {batch && (
          <span className="flex items-center gap-2 text-xs text-muted">
            Batch {batch}
            <CopyButton label="Copy all links" text={() => reports.filter((r) => r.status === "done").map((r) => `${r.businessName ?? r.url}\t${r.score}\t${r.link}`).join("\n")} />
          </span>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
      {!reports.length && <p className="text-sm text-muted">No reports yet. Grade a prospect above, or share the public grader link.</p>}

      <ul className="flex flex-col gap-2">
        {reports.map((r) => (
          <ReportRow key={r.id} r={r} onChange={refresh} />
        ))}
      </ul>
    </div>
  );
}

function Setup({ ok, label, todo }: { ok: boolean; label: string; todo: string }) {
  return (
    <li className="flex gap-2">
      <span className={ok ? "text-success" : "text-warning"}>{ok ? "✓" : "○"}</span>
      <span>
        <b>{label}</b>
        {ok ? "" : ` — ${todo}`}
      </span>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

function CopyButton({ text, label = "Copy" }: { text: () => string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="text-xs text-accent hover:underline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text());
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

function SingleForm({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ url: "", businessName: "", city: "", keyword: "" });
  const run = useMutation({
    mutationFn: () => api("/api/sites/grader", { method: "POST", body: JSON.stringify(f) }),
    onSuccess: () => {
      setF({ url: "", businessName: "", city: "", keyword: "" });
      onDone();
    },
  });
  return (
    <Card title="Grade a prospect">
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run.mutate();
        }}
      >
        <Input id="gr-url" required value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="theirsite.com" />
        <div className="grid grid-cols-2 gap-2">
          <Input id="gr-biz" value={f.businessName} onChange={(e) => setF({ ...f, businessName: e.target.value })} placeholder="Business name" />
          <Input id="gr-city" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} placeholder="Town, ST" />
        </div>
        <Input id="gr-kw" value={f.keyword} onChange={(e) => setF({ ...f, keyword: e.target.value })} placeholder="Main service (for the Maps grid)" />
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={run.isPending || !f.url}>
            {run.isPending ? "Queuing…" : "Grade it"}
          </Button>
          {run.error && <span className="text-xs text-destructive">{(run.error as Error).message}</span>}
        </div>
      </form>
    </Card>
  );
}

function BulkForm({ onDone }: { onDone: (batchId: string) => void }) {
  const [text, setText] = useState("");
  const [keyword, setKeyword] = useState("");
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.split(/\t|,/).map((x) => x.trim()))
    .filter((p) => p[0])
    .map(([url, businessName, ...rest]) => ({ url: url!, businessName: businessName || undefined, city: rest.join(", ") || undefined }));
  const run = useMutation({
    mutationFn: () => api<{ batchId: string; queued: number }>("/api/sites/grader/bulk", { method: "POST", body: JSON.stringify({ keyword, rows }) }),
    onSuccess: (r) => {
      setText("");
      onDone(r.batchId);
    },
  });
  return (
    <Card title="Grade a list">
      <div className="flex flex-col gap-2">
        <Textarea
          id="gr-bulk"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"One per line: website, business name, town\nhaulitwooster.com, Haul-It, Wooster OH"}
        />
        <Input id="gr-bulk-kw" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Main service for all (e.g. junk removal)" />
        <div className="flex items-center gap-2">
          <Button onClick={() => run.mutate()} disabled={run.isPending || rows.length === 0 || rows.length > 100}>
            {run.isPending ? "Queuing…" : `Grade ${rows.length || ""} site${rows.length === 1 ? "" : "s"}`}
          </Button>
          <span className="text-xs text-muted">{rows.length > 100 ? "100 at a time" : "Runs spaced ~20s apart"}</span>
        </div>
        {run.error && <span className="text-xs text-destructive">{(run.error as Error).message}</span>}
      </div>
    </Card>
  );
}

function ReportRow({ r, onChange }: { r: Report; onChange: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const rerun = useMutation({ mutationFn: () => api(`/api/sites/grader/${r.id}/rerun`, { method: "POST", body: "{}" }), onSettled: onChange });
  const del = useMutation({ mutationFn: () => api(`/api/sites/grader/${r.id}`, { method: "DELETE" }), onSettled: onChange });
  const name = r.businessName ?? r.url.replace(/^https?:\/\//, "").replace(/\/$/, "");

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <div className={`w-10 shrink-0 text-center text-2xl font-bold ${LETTER_CLS[r.letter ?? ""] ?? "text-muted"}`}>
          {r.status === "done" ? r.letter : r.status === "failed" ? "!" : "…"}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <a href={r.link} target="_blank" rel="noreferrer" className="truncate font-medium hover:underline">
              {name}
            </a>
            {r.status === "done" && <span className="text-xs tabular-nums text-muted">{r.score}/100</span>}
            <Badge>{r.source === "public" ? "inbound" : r.source}</Badge>
            {r.utm?.source && <Badge>{r.utm.source}</Badge>}
          </div>
          <div className="text-xs text-muted">
            {r.source === "public" && (
              <>
                {r.contactName} · <span className="select-all">{r.contactEmail}</span>
                {r.contactPhone ? <> · <span className="select-all">{r.contactPhone}</span></> : null} ·{" "}
              </>
            )}
            {r.city ? `${r.city} · ` : ""}
            {ago(r.createdAt)}
          </div>
          {r.status === "done" && r.result.topFixes?.[0] && <div className="text-xs">Top fix: {r.result.topFixes[0].label}</div>}
          {r.status === "failed" && <div className="text-xs text-destructive">{r.error}</div>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className={r.views ? "font-medium text-success" : "text-muted"} title={r.lastViewedAt ? `Last opened ${ago(r.lastViewedAt)}` : "Not opened yet"}>
          {r.views ? `Opened ${r.views}× · ${ago(r.lastViewedAt)}` : "Not opened"}
        </span>
        {r.status === "done" && <CopyButton text={() => r.link} label="Copy link" />}
        {r.status === "done" && r.source !== "public" && <CopyButton text={() => pitch(r)} label="Copy pitch" />}
        <button className="text-muted hover:text-foreground" onClick={() => rerun.mutate()} disabled={rerun.isPending}>
          Re-grade
        </button>
        {confirm ? (
          <span className="flex items-center gap-2">
            <button className="text-destructive" onClick={() => del.mutate()}>
              Delete + kill link
            </button>
            <button className="text-muted" onClick={() => setConfirm(false)}>
              Keep
            </button>
          </span>
        ) : (
          <button className="text-muted hover:text-destructive" onClick={() => setConfirm(true)}>
            Delete
          </button>
        )}
      </div>
    </li>
  );
}

