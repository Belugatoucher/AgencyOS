"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, Button, Card, Input, Select } from "@/components/ui";
import { api } from "@/lib/fetcher";

type Account = { id: string; name: string };
type Hook = {
  id: string;
  text: string;
  format: string;
  platform: string | null;
  nicheTags: string[];
  similarity: number | null;
};
type ResearchDoc = { id: string; title: string; kind: string; status: string; createdAt: string };
type ChunkHit = { chunkId: string; docTitle: string; kind: string; chunkText: string; similarity: number };
type Creative = {
  id: string;
  platform: string;
  metrics: Record<string, number>;
  spendCents: number;
  isWinning: boolean;
  learning: string | null;
};
type Brain = {
  accountId: string;
  offer: string | null;
  icp: string | null;
  positioning: string | null;
  voice: { do?: string[]; dont?: string[]; samples?: string[] };
  objections: string[];
  proofPoints: string[];
  complianceNos: string[];
  goalsCurrentQuarter: string | null;
  learnings: { text: string; source: string }[];
  version: number;
};
type Suggestion = { id: string; field: string; proposed: { text?: string }; source: string };
type ChatReply = { threadId: string; reply: string; citations: string[] };

const HOOK_FORMATS = ["question", "callout", "stat", "story_open", "contrarian", "pain", "curiosity", "social_proof"];
const RESEARCH_KINDS = ["competitor", "audience", "voc", "trend", "strategy"];
const TABS = ["Hooks", "Research", "Creatives", "Brain", "Chat"] as const;

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = "", ...rest } = props;
  return (
    <textarea
      className={`rounded-md border border-border bg-card px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent ${className}`}
      {...rest}
    />
  );
}

export function IntelligenceClient() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Hooks");
  const [accountId, setAccountId] = useState("");
  const { data: accounts } = useQuery({ queryKey: ["accounts"], queryFn: () => api<Account[]>("/api/accounts") });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Intelligence</h1>
        <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} data-testid="intel-account">
          <option value="">Select client…</option>
          {accounts?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </div>
      <nav className="flex gap-1 border-b border-border text-sm">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            data-testid={`intel-tab-${t.toLowerCase()}`}
            className={`rounded-t-md px-3 py-1.5 ${tab === t ? "border border-b-0 border-border bg-card font-medium" : "text-muted hover:text-foreground"}`}
          >
            {t}
          </button>
        ))}
      </nav>
      {tab === "Hooks" && <HooksPanel accountId={accountId} />}
      {tab === "Research" && <ResearchPanel accountId={accountId} />}
      {tab === "Creatives" && <CreativesPanel accountId={accountId} />}
      {tab === "Brain" && (accountId ? <BrainPanel accountId={accountId} /> : <PickClient />)}
      {tab === "Chat" && (accountId ? <ChatPanel accountId={accountId} /> : <PickClient />)}
    </div>
  );
}

function PickClient() {
  return <p className="text-sm text-muted">Pick a client above — the Brain is per-client.</p>;
}

function HooksPanel({ accountId }: { accountId: string }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [submittedQ, setSubmittedQ] = useState("");
  const [format, setFormat] = useState("");
  const [text, setText] = useState("");
  const [newFormat, setNewFormat] = useState("question");
  const [platform, setPlatform] = useState("");

  const params = new URLSearchParams();
  if (submittedQ) params.set("q", submittedQ);
  if (format) params.set("format", format);
  if (accountId) params.set("account", accountId);
  const { data: hooks } = useQuery({
    queryKey: ["hooks", submittedQ, format, accountId],
    queryFn: () => api<Hook[]>(`/api/hooks?${params.toString()}`),
  });

  const create = useMutation({
    mutationFn: () =>
      api<Hook>("/api/hooks", {
        method: "POST",
        body: JSON.stringify({
          text,
          format: newFormat,
          platform: platform || null,
          accountId: accountId || null,
        }),
      }),
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: ["hooks"] });
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmittedQ(q);
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search hooks by meaning" className="flex-1" data-testid="hooks-search" />
        <Select value={format} onChange={(e) => setFormat(e.target.value)}>
          <option value="">Any format</option>
          {HOOK_FORMATS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      <Card title="Add hook">
        <div className="flex flex-wrap gap-2">
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Hook text" className="flex-1" data-testid="hook-text" />
          <Select value={newFormat} onChange={(e) => setNewFormat(e.target.value)} data-testid="hook-format">
            {HOOK_FORMATS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </Select>
          <Input value={platform} onChange={(e) => setPlatform(e.target.value)} placeholder="Platform" className="w-28" />
          <Button disabled={!text.trim() || create.isPending} onClick={() => create.mutate()} data-testid="hook-create">
            Add {accountId ? "for client" : "to global library"}
          </Button>
        </div>
      </Card>

      <Card title={submittedQ ? `Results for "${submittedQ}"` : "Library"}>
        {hooks?.length ? (
          <ul className="flex flex-col gap-1" data-testid="hooks-list">
            {hooks.map((h) => (
              <li key={h.id} className="rounded-md border border-border bg-card p-3 text-sm">
                <p>{h.text}</p>
                <p className="mt-1 flex items-center gap-2 text-xs text-muted">
                  <Badge>{h.format}</Badge>
                  {h.platform && <span>{h.platform}</span>}
                  {h.nicheTags.map((t) => (
                    <span key={t}>#{t}</span>
                  ))}
                  {h.similarity != null && <span>{(h.similarity * 100).toFixed(0)}% match</span>}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No hooks yet — add one or import a CSV.</p>
        )}
      </Card>
    </div>
  );
}

function ResearchPanel({ accountId }: { accountId: string }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("voc");
  const [rawText, setRawText] = useState("");
  const [q, setQ] = useState("");
  const [submittedQ, setSubmittedQ] = useState("");

  const { data: docs } = useQuery({
    queryKey: ["research", accountId],
    queryFn: () => api<ResearchDoc[]>(`/api/research${accountId ? `?account=${accountId}` : ""}`),
  });
  const { data: hits } = useQuery({
    queryKey: ["research-search", submittedQ, accountId],
    queryFn: () =>
      api<ChunkHit[]>(
        `/api/research/search?q=${encodeURIComponent(submittedQ)}${accountId ? `&account=${accountId}` : ""}`,
      ),
    enabled: submittedQ.length > 0,
  });

  const create = useMutation({
    mutationFn: () =>
      api<ResearchDoc>("/api/research", {
        method: "POST",
        body: JSON.stringify({ title, kind, rawText, accountId: accountId || null }),
      }),
    onSuccess: () => {
      setTitle("");
      setRawText("");
      qc.invalidateQueries({ queryKey: ["research"] });
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmittedQ(q);
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search research semantically" className="flex-1" data-testid="research-search" />
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>
      {submittedQ && (
        <Card title={`Chunks matching "${submittedQ}"`}>
          {hits?.length ? (
            <ul className="flex flex-col gap-1 text-sm" data-testid="research-hits">
              {hits.map((h) => (
                <li key={h.chunkId} className="rounded-md border border-border bg-card p-3">
                  <p className="text-xs text-muted">
                    {h.docTitle} · <Badge>{h.kind}</Badge> · {(h.similarity * 100).toFixed(0)}%
                  </p>
                  <p className="mt-1">{h.chunkText.slice(0, 400)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No matches.</p>
          )}
        </Card>
      )}

      <Card title="Add research (paste)">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="flex-1" data-testid="research-title" />
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              {RESEARCH_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </Select>
          </div>
          <Textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="Paste the research text — it gets chunked + embedded for retrieval"
            rows={5}
            data-testid="research-text"
          />
          <Button
            disabled={!title.trim() || !rawText.trim() || create.isPending}
            onClick={() => create.mutate()}
            className="self-start"
            data-testid="research-create"
          >
            Add {accountId ? "for client" : "as general research"}
          </Button>
        </div>
      </Card>

      <Card title="Documents">
        {docs?.length ? (
          <ul className="flex flex-col gap-1 text-sm" data-testid="research-list">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center justify-between rounded-md border border-border bg-card p-3">
                <span className="font-medium">{d.title}</span>
                <span className="flex items-center gap-2 text-xs text-muted">
                  <Badge>{d.kind}</Badge>
                  <Badge>{d.status}</Badge>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No research yet.</p>
        )}
      </Card>
    </div>
  );
}

function CreativesPanel({ accountId }: { accountId: string }) {
  const qc = useQueryClient();
  const [platform, setPlatform] = useState("meta");
  const [spend, setSpend] = useState("");
  const [roas, setRoas] = useState("");
  const [learning, setLearning] = useState("");

  const { data: rows } = useQuery({
    queryKey: ["creatives", accountId],
    queryFn: () => api<Creative[]>(`/api/creatives?account=${accountId}`),
    enabled: !!accountId,
  });

  const create = useMutation({
    mutationFn: () =>
      api<Creative>("/api/creatives", {
        method: "POST",
        body: JSON.stringify({
          accountId,
          platform,
          spendCents: Math.round(Number(spend || 0) * 100),
          metrics: roas ? { roas: Number(roas) } : {},
          learning: learning || null,
        }),
      }),
    onSuccess: () => {
      setSpend("");
      setRoas("");
      setLearning("");
      qc.invalidateQueries({ queryKey: ["creatives"] });
    },
  });

  if (!accountId) return <PickClient />;
  return (
    <div className="flex flex-col gap-4">
      <Card title="Log creative result">
        <div className="flex flex-wrap gap-2">
          <Input value={platform} onChange={(e) => setPlatform(e.target.value)} placeholder="Platform" className="w-28" data-testid="creative-platform" />
          <Input value={spend} onChange={(e) => setSpend(e.target.value)} placeholder="Spend $" className="w-24" data-testid="creative-spend" />
          <Input value={roas} onChange={(e) => setRoas(e.target.value)} placeholder="ROAS" className="w-20" data-testid="creative-roas" />
          <Input
            value={learning}
            onChange={(e) => setLearning(e.target.value)}
            placeholder="Learning (proposes a Brain update)"
            className="flex-1"
            data-testid="creative-learning"
          />
          <Button disabled={!platform.trim() || create.isPending} onClick={() => create.mutate()} data-testid="creative-create">
            Log
          </Button>
        </div>
      </Card>
      <Card title="Creatives">
        {rows?.length ? (
          <ul className="flex flex-col gap-1 text-sm" data-testid="creatives-list">
            {rows.map((c) => (
              <li key={c.id} className="rounded-md border border-border bg-card p-3">
                <p className="flex items-center gap-2">
                  <Badge>{c.platform}</Badge>
                  {c.isWinning && <Badge>🏆 winning</Badge>}
                  <span className="text-xs text-muted">
                    ${(c.spendCents / 100).toFixed(2)} spend
                    {typeof c.metrics.roas === "number" && ` · ${c.metrics.roas.toFixed(2)}x ROAS`}
                  </span>
                </p>
                {c.learning && <p className="mt-1 text-muted">{c.learning}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No creatives logged.</p>
        )}
      </Card>
    </div>
  );
}

function BrainPanel({ accountId }: { accountId: string }) {
  const qc = useQueryClient();
  const { data: brain } = useQuery({
    queryKey: ["brain", accountId],
    queryFn: () => api<Brain>(`/api/brain/${accountId}`),
  });
  const { data: suggestions } = useQuery({
    queryKey: ["brain-suggestions", accountId],
    queryFn: () => api<Suggestion[]>(`/api/brain/${accountId}/suggestions`),
  });
  const [draft, setDraft] = useState<Record<string, string> | null>(null);

  const fields: [key: string, label: string, list: boolean][] = [
    ["offer", "Offer", false],
    ["icp", "ICP", false],
    ["positioning", "Positioning", false],
    ["objections", "Objections (one per line)", true],
    ["proofPoints", "Proof points — the ONLY claims source (one per line)", true],
    ["complianceNos", "Compliance no-gos — hard blocks (one per line)", true],
    ["goalsCurrentQuarter", "Goals this quarter", false],
  ];

  const current: Record<string, string> =
    draft ??
    Object.fromEntries(
      fields.map(([key, , list]) => {
        const v = brain?.[key as keyof Brain];
        return [key, list ? ((v as string[]) ?? []).join("\n") : ((v as string) ?? "")];
      }),
    );

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {};
      for (const [key, , list] of fields) {
        body[key] = list
          ? current[key]!.split("\n").map((s) => s.trim()).filter(Boolean)
          : current[key] || null;
      }
      return api<Brain>(`/api/brain/${accountId}`, { method: "PATCH", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      setDraft(null);
      qc.invalidateQueries({ queryKey: ["brain", accountId] });
    },
  });

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "accepted" | "rejected" }) =>
      api(`/api/brain/suggestions/${id}`, { method: "POST", body: JSON.stringify({ decision }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brain-suggestions", accountId] });
      qc.invalidateQueries({ queryKey: ["brain", accountId] });
    },
  });

  if (!brain) return <p className="text-sm text-muted">Loading…</p>;
  return (
    <div className="flex flex-col gap-4">
      {suggestions && suggestions.length > 0 && (
        <Card title={`Pending suggestions (${suggestions.length})`}>
          <ul className="flex flex-col gap-1 text-sm" data-testid="brain-suggestions">
            {suggestions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-card p-3">
                <span>
                  <Badge>{s.field}</Badge> <Badge>{s.source}</Badge> {s.proposed.text}
                </span>
                <span className="flex gap-1">
                  <Button variant="outline" onClick={() => decide.mutate({ id: s.id, decision: "accepted" })}>
                    Accept
                  </Button>
                  <Button variant="outline" onClick={() => decide.mutate({ id: s.id, decision: "rejected" })}>
                    Reject
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={`Client Brain (v${brain.version})`}>
        <div className="flex flex-col gap-3">
          {fields.map(([key, label]) => (
            <label key={key} className="flex flex-col gap-1 text-sm">
              <span className="text-xs font-medium text-muted">{label}</span>
              <Textarea
                value={current[key]}
                onChange={(e) => setDraft({ ...current, [key]: e.target.value })}
                rows={key === "offer" || key === "icp" || key === "positioning" ? 2 : 3}
                data-testid={`brain-${key}`}
              />
            </label>
          ))}
          <Button disabled={!draft || save.isPending} onClick={() => save.mutate()} className="self-start" data-testid="brain-save">
            Save (snapshots v{brain.version})
          </Button>
        </div>
      </Card>

      {brain.learnings.length > 0 && (
        <Card title="Learnings">
          <ul className="flex flex-col gap-1 text-sm">
            {brain.learnings.map((l, i) => (
              <li key={i} className="rounded-md border border-border bg-card p-2">
                {l.text} <span className="text-xs text-muted">({l.source})</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function ChatPanel({ accountId }: { accountId: string }) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [log, setLog] = useState<{ role: "you" | "brain"; text: string; citations?: string[] }[]>([]);

  const send = useMutation({
    mutationFn: (text: string) =>
      api<ChatReply>(`/api/brain/${accountId}/chat`, {
        method: "POST",
        body: JSON.stringify({ message: text, threadId }),
      }),
    onSuccess: (r) => {
      setThreadId(r.threadId);
      setLog((l) => [...l, { role: "brain", text: r.reply, citations: r.citations }]);
    },
    onError: (e) => {
      setLog((l) => [...l, { role: "brain", text: `⚠️ ${(e as Error).message}` }]);
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <Card title="Ask the Brain">
        <div className="flex flex-col gap-2" data-testid="chat-log">
          {log.length === 0 && (
            <p className="text-sm text-muted">
              Retrieval-grounded chat: the Brain reads this client's brain, winning creatives, the hooks
              library, and research — read-only — and cites what it used.
            </p>
          )}
          {log.map((m, i) => (
            <div key={i} className={`rounded-md border border-border p-3 text-sm ${m.role === "you" ? "bg-background" : "bg-card"}`}>
              <p className="mb-1 text-xs font-medium text-muted">{m.role === "you" ? "You" : "Brain"}</p>
              <p className="whitespace-pre-wrap">{m.text}</p>
              {m.citations && m.citations.length > 0 && (
                <p className="mt-2 flex flex-wrap gap-1">
                  {m.citations.map((c) => (
                    <Badge key={c}>{c}</Badge>
                  ))}
                </p>
              )}
            </div>
          ))}
          {send.isPending && <p className="text-sm text-muted">Thinking…</p>}
        </div>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const text = message.trim();
            if (!text) return;
            setLog((l) => [...l, { role: "you", text }]);
            setMessage("");
            send.mutate(text);
          }}
        >
          <Input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Draft a TikTok script about… / What objections do we hear about price?"
            className="flex-1"
            data-testid="chat-input"
          />
          <Button type="submit" disabled={send.isPending} data-testid="chat-send">
            Send
          </Button>
        </form>
      </Card>
    </div>
  );
}
