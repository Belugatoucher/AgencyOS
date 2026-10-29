"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Input, Select } from "@/components/ui";
import { api } from "@/lib/fetcher";
import { uploadFile } from "@/lib/upload-client";

type Account = { id: string; name: string };
type Goal = {
  id: string;
  title: string;
  detail: string | null;
  horizon: "quarter" | "year" | "long_term";
  metric: string | null;
  target: string | null;
  dueOn: string | null;
  status: "active" | "achieved" | "dropped";
};
type SessionRow = { id: string; title: string | null; source: string; status: string; summary: string | null; themes: string[]; createdAt: string };
type Item = {
  id: string;
  kind: "action" | "goal" | "idea" | "question" | "risk";
  title: string;
  detail: string | null;
  goalTitle: string | null;
  alignment: "advances" | "new_direction" | "off_strategy";
  alignmentNote: string | null;
  impact: number | null;
  effort: number | null;
  horizon: string | null;
  suggestedDue: string | null;
  quote: string | null;
  status: "proposed" | "accepted" | "dismissed" | "parked";
  taskId: string | null;
  score: number;
};
type SessionDetail = {
  session: SessionRow & { transcript: string | null; error: string | null };
  groups: { doNext: Item[]; goals: Item[]; park: Item[]; questions: Item[]; flags: Item[] };
};

const LS_KEY = "ideas.account";
const HORIZON_LABEL: Record<string, string> = { quarter: "This quarter", year: "This year", long_term: "Long term" };
const WHEN_LABEL: Record<string, string> = { now: "Now", this_week: "This week", this_month: "This month", this_quarter: "This quarter", later: "Later" };

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = "", ...rest } = props;
  return (
    <textarea
      className={`rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent ${className}`}
      {...rest}
    />
  );
}

export function IdeasClient() {
  const router = useRouter();
  const params = useSearchParams();
  const sessionId = params.get("session");
  const [accountId, setAccountId] = useState("");
  const { data: accounts } = useQuery({ queryKey: ["accounts"], queryFn: () => api<Account[]>("/api/accounts") });

  // remember the last business picked (per-browser convenience only)
  useEffect(() => {
    if (accountId || !accounts?.length) return;
    let saved = "";
    try {
      saved = localStorage.getItem(LS_KEY) ?? "";
    } catch {
      /* storage blocked */
    }
    setAccountId(accounts.some((a) => a.id === saved) ? saved : accounts[0]!.id);
  }, [accounts, accountId]);
  function pick(id: string) {
    setAccountId(id);
    try {
      localStorage.setItem(LS_KEY, id);
    } catch {
      /* storage blocked */
    }
    router.push("/ideas");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Ideas</h1>
          <p className="text-sm text-muted">Think out loud. Get back what to do next, ranked against your goals.</p>
        </div>
        <Select value={accountId} onChange={(e) => pick(e.target.value)} data-testid="ideas-account" aria-label="Business">
          {accounts?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </div>

      {accountId && (
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <GoalsPanel accountId={accountId} />
          <div className="flex min-w-0 flex-col gap-4">
            {sessionId ? (
              <SessionReview id={sessionId} onBack={() => router.push("/ideas")} />
            ) : (
              <>
                <Composer accountId={accountId} onCreated={(id) => router.push(`/ideas?session=${id}`)} />
                <SessionList accountId={accountId} onOpen={(id) => router.push(`/ideas?session=${id}`)} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Goals ----------

function GoalsPanel({ accountId }: { accountId: string }) {
  const qc = useQueryClient();
  const key = ["goals", accountId];
  const { data: goals } = useQuery({ queryKey: key, queryFn: () => api<Goal[]>(`/api/ideas/goals?account=${accountId}`) });
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: "", metric: "", target: "", horizon: "quarter", dueOn: "" });

  const create = useMutation({
    mutationFn: () =>
      api<Goal>("/api/ideas/goals", {
        method: "POST",
        body: JSON.stringify({ accountId, ...form, metric: form.metric || null, target: form.target || null, dueOn: form.dueOn || null }),
      }),
    onSuccess: () => {
      setForm({ title: "", metric: "", target: "", horizon: "quarter", dueOn: "" });
      setAdding(false);
      qc.invalidateQueries({ queryKey: key });
    },
  });
  const patch = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Goal["status"] }) =>
      api<Goal>(`/api/ideas/goals/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Goal[]>(key);
      qc.setQueryData<Goal[]>(key, (g) => g?.map((x) => (x.id === id ? { ...x, status } : x)));
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(key, ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  const active = goals?.filter((g) => g.status === "active") ?? [];
  const closed = goals?.filter((g) => g.status !== "active") ?? [];

  return (
    <Card
      title="Goals"
      actions={
        <Button variant="outline" onClick={() => setAdding((v) => !v)}>
          {adding ? "Close" : "Add goal"}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        {adding && (
          <form
            className="flex flex-col gap-2 rounded-md border border-border p-2"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <Input id="goal-title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. 40 booked junk jobs a week" />
            <Input id="goal-metric" value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value })} placeholder="Metric (booked jobs/week)" />
            <div className="flex gap-2">
              <Input id="goal-target" className="min-w-0 flex-1" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} placeholder="Target (40)" />
              <Input id="goal-due" className="min-w-0 flex-1" type="date" value={form.dueOn} onChange={(e) => setForm({ ...form, dueOn: e.target.value })} aria-label="Due" />
            </div>
            <Select id="goal-horizon" value={form.horizon} onChange={(e) => setForm({ ...form, horizon: e.target.value })}>
              <option value="quarter">This quarter</option>
              <option value="year">This year</option>
              <option value="long_term">Long term</option>
            </Select>
            <Button type="submit" disabled={create.isPending || !form.title.trim()}>
              Save goal
            </Button>
            {create.error && <p className="text-xs text-destructive">{(create.error as Error).message}</p>}
          </form>
        )}

        {!goals?.length && !adding && (
          <p className="text-sm text-muted">No goals yet. Add two or three so Claude can tell you what matters in a ramble. Without them, it proposes some.</p>
        )}

        {(["quarter", "year", "long_term"] as const).map((h) => {
          const list = active.filter((g) => g.horizon === h);
          if (!list.length) return null;
          return (
            <div key={h} className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted">{HORIZON_LABEL[h]}</span>
              {list.map((g) => (
                <div key={g.id} className="flex items-start justify-between gap-2 border-b border-border py-1.5 text-sm last:border-0">
                  <div className="min-w-0">
                    <div className="font-medium">{g.title}</div>
                    {(g.metric || g.target || g.dueOn) && (
                      <div className="text-xs text-muted">
                        {[g.metric, g.target && `→ ${g.target}`, g.dueOn && `by ${g.dueOn}`].filter(Boolean).join(" ")}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button className="text-xs text-success hover:underline" onClick={() => patch.mutate({ id: g.id, status: "achieved" })}>
                      Done
                    </button>
                    <button className="text-xs text-muted hover:underline" onClick={() => patch.mutate({ id: g.id, status: "dropped" })}>
                      Drop
                    </button>
                  </div>
                </div>
              ))}
            </div>
          );
        })}

        {closed.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-xs text-muted">{closed.length} achieved or dropped</summary>
            <ul className="mt-1 flex flex-col gap-1">
              {closed.map((g) => (
                <li key={g.id} className="flex justify-between gap-2 text-xs">
                  <span className={g.status === "achieved" ? "" : "text-muted line-through"}>{g.title}</span>
                  <button className="text-muted hover:underline" onClick={() => patch.mutate({ id: g.id, status: "active" })}>
                    Reopen
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Card>
  );
}

// ---------- Composer (type or talk) ----------

function pickMime(): { mime: string; ext: string } {
  const options = [
    { mime: "audio/webm;codecs=opus", ext: "webm" },
    { mime: "audio/webm", ext: "webm" },
    { mime: "audio/mp4", ext: "m4a" },
  ];
  for (const o of options) if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(o.mime)) return o;
  return { mime: "", ext: "webm" };
}

function Composer({ accountId, onCreated }: { accountId: string; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [rec, setRec] = useState<"idle" | "recording" | "uploading">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const submitText = useMutation({
    mutationFn: () => api<{ id: string }>("/api/ideas/sessions", { method: "POST", body: JSON.stringify({ accountId, text }) }),
    onSuccess: (s) => {
      setText("");
      qc.invalidateQueries({ queryKey: ["idea-sessions", accountId] });
      onCreated(s.id);
    },
  });

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const { mime } = pickMime();
      const r = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.start(10_000);
      recorder.current = r;
      setRec("recording");
      setElapsed(0);
      timer.current = setInterval(() => setElapsed((n) => n + 1), 1000);
    } catch {
      setError("Microphone access was blocked. Allow it in the browser, or type instead.");
    }
  }

  async function stop() {
    const r = recorder.current;
    if (!r) return;
    if (timer.current) clearInterval(timer.current);
    setRec("uploading");
    await new Promise<void>((resolve) => {
      r.onstop = () => resolve();
      r.stop();
    });
    r.stream.getTracks().forEach((t) => t.stop());
    const { ext } = pickMime();
    const type = r.mimeType || "audio/webm";
    const blob = new Blob(chunks.current, { type });
    try {
      const file = await uploadFile(accountId, new File([blob], `ramble-${new Date().toISOString().slice(0, 16)}.${ext}`, { type }));
      const s = await api<{ id: string }>("/api/ideas/sessions", { method: "POST", body: JSON.stringify({ accountId, audioFileId: file.id }) });
      qc.invalidateQueries({ queryKey: ["idea-sessions", accountId] });
      onCreated(s.id);
    } catch (e) {
      setError(`${(e as Error).message}. The recording wasn't saved — try again, or type it.`);
    } finally {
      setRec("idle");
    }
  }

  const mm = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;

  return (
    <Card title="Ramble">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {rec === "idle" && (
            <Button onClick={start} data-testid="ideas-record">
              ● Talk it out
            </Button>
          )}
          {rec === "recording" && (
            <Button variant="danger" onClick={stop} data-testid="ideas-stop">
              ■ Done talking ({mm})
            </Button>
          )}
          {rec === "uploading" && <span className="text-sm text-muted">Saving the recording…</span>}
          <span className="text-xs text-muted">Audio stays on our servers; only the transcript goes to Claude.</span>
        </div>
        <Textarea
          id="ideas-text"
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Or type / paste. Don't organize it. What's on your mind about the business, what's bugging you, what you want next…"
          disabled={rec !== "idle"}
        />
        <div className="flex items-center gap-3">
          <Button onClick={() => submitText.mutate()} disabled={!text.trim() || submitText.isPending || rec !== "idle"}>
            {submitText.isPending ? "Sending…" : "Find the action items"}
          </Button>
          <span className="text-xs text-muted">{text.length ? `${text.split(/\s+/).filter(Boolean).length} words` : ""}</span>
        </div>
        {(error || submitText.error) && <p className="text-sm text-destructive">{error ?? (submitText.error as Error).message}</p>}
      </div>
    </Card>
  );
}

// ---------- History ----------

function SessionList({ accountId, onOpen }: { accountId: string; onOpen: (id: string) => void }) {
  const { data } = useQuery({
    queryKey: ["idea-sessions", accountId],
    queryFn: () => api<SessionRow[]>(`/api/ideas/sessions?account=${accountId}`),
    refetchInterval: (q) => ((q.state.data as SessionRow[] | undefined)?.some((s) => s.status === "transcribing" || s.status === "thinking") ? 5000 : false),
  });
  if (!data?.length) return null;
  return (
    <Card title="Past rambles">
      <ul className="flex flex-col">
        {data.map((s) => (
          <li key={s.id}>
            <button className="flex w-full flex-col gap-0.5 border-b border-border py-2 text-left last:border-0 hover:bg-background" onClick={() => onOpen(s.id)}>
              <span className="flex items-center gap-2 text-sm font-medium">
                {s.title ?? (s.status === "ready" ? "Untitled ramble" : "Working on it…")}
                {s.status !== "ready" && <Badge>{s.status}</Badge>}
              </span>
              <span className="text-xs text-muted">
                {new Date(s.createdAt).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                {s.source === "voice" ? " · voice" : ""}
                {s.themes?.length ? ` · ${s.themes.join(", ")}` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---------- Review ----------

function SessionReview({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const key = ["idea-session", id];
  const { data, error } = useQuery({
    queryKey: key,
    queryFn: () => api<SessionDetail>(`/api/ideas/sessions/${id}`),
    refetchInterval: (q) => {
      const st = (q.state.data as SessionDetail | undefined)?.session.status;
      return st === "transcribing" || st === "thinking" ? 4000 : false;
    },
  });
  const acceptAll = useMutation({
    mutationFn: () => api<{ accepted: number }>(`/api/ideas/sessions/${id}/accept-actions`, { method: "POST", body: "{}" }),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
  const retry = useMutation({
    mutationFn: () => api(`/api/ideas/sessions/${id}/retry`, { method: "POST", body: "{}" }),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  if (!data) return <p className="text-sm text-muted">Loading…</p>;
  const { session, groups } = data;
  const pendingActions = groups.doNext.filter((i) => i.status === "proposed").length;

  return (
    <div className="flex flex-col gap-4">
      <button className="self-start text-xs text-muted hover:text-foreground" onClick={onBack}>
        ← New ramble
      </button>

      {session.status === "transcribing" && <Card title="Transcribing your recording…">A minute or two for a few minutes of talking.</Card>}
      {session.status === "thinking" && <Card title="Reading it against your goals…">Usually under a minute.</Card>}
      {session.status === "failed" && (
        <Card title="That didn't work">
          <p className="mb-2 text-sm">{session.error}</p>
          <Button onClick={() => retry.mutate()} disabled={retry.isPending}>
            Retry
          </Button>
        </Card>
      )}

      {session.status === "ready" && (
        <>
          <Card title={session.title ?? "Your ramble"} actions={<div className="flex flex-wrap gap-1">{session.themes.map((t) => <Badge key={t}>{t}</Badge>)}</div>}>
            <p className="text-sm">{session.summary}</p>
            {session.transcript && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-muted">What you said</summary>
                <p className="mt-1 whitespace-pre-wrap text-xs text-muted">{session.transcript}</p>
              </details>
            )}
          </Card>

          <Group
            title="Do next"
            hint="Ranked by goal alignment × impact ÷ effort"
            items={groups.doNext}
            sessionKey={key}
            actions={
              pendingActions > 1 ? (
                <Button variant="outline" onClick={() => acceptAll.mutate()} disabled={acceptAll.isPending}>
                  Add all {pendingActions} to my tasks
                </Button>
              ) : null
            }
          />
          <Group title="New goals" hint="Not covered by an active goal yet" items={groups.goals} sessionKey={key} />
          <Group title="Strategy flags" hint="Pulls away from your goals — decide on purpose" items={groups.flags} sessionKey={key} tone="warn" />
          <Group title="Open questions" items={groups.questions} sessionKey={key} />
          <Group title="Park for later" items={groups.park} sessionKey={key} />
        </>
      )}
    </div>
  );
}

function Group({
  title,
  hint,
  items,
  sessionKey,
  actions,
  tone,
}: {
  title: string;
  hint?: string;
  items: Item[];
  sessionKey: string[];
  actions?: React.ReactNode;
  tone?: "warn";
}) {
  if (!items.length) return null;
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className={`text-sm font-semibold ${tone === "warn" ? "text-warning" : ""}`}>
            {title} <span className="font-normal text-muted">({items.length})</span>
          </h2>
          {hint && <p className="text-xs text-muted">{hint}</p>}
        </div>
        {actions}
      </div>
      {items.map((i) => (
        <ItemCard key={i.id} item={i} sessionKey={sessionKey} />
      ))}
    </section>
  );
}

const ALIGN: Record<Item["alignment"], { label: string; cls: string }> = {
  advances: { label: "Advances", cls: "border-success/40 text-success" },
  new_direction: { label: "New direction", cls: "border-accent/40 text-accent" },
  off_strategy: { label: "Off strategy", cls: "border-warning/40 text-warning" },
};

function Dots({ n, label }: { n: number | null; label: string }) {
  const v = n ?? 0;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted" title={`${label} ${v}/5`}>
      {label}
      <span aria-hidden className="tracking-tighter">
        {"●".repeat(v)}
        <span className="opacity-30">{"●".repeat(5 - v)}</span>
      </span>
      <span className="sr-only">{v} of 5</span>
    </span>
  );
}

function ItemCard({ item, sessionKey }: { item: Item; sessionKey: string[] }) {
  const qc = useQueryClient();
  const [due, setDue] = useState(item.suggestedDue ?? "");
  const decide = useMutation({
    mutationFn: (decision: "accept" | "dismiss" | "park") =>
      api(`/api/ideas/items/${item.id}`, {
        method: "POST",
        body: JSON.stringify({ decision, ...(item.kind === "action" || item.kind === "goal" ? { dueOn: due || null } : {}) }),
      }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: sessionKey });
      qc.invalidateQueries({ queryKey: ["goals"] });
    },
  });
  const decided = item.status !== "proposed";
  const align = ALIGN[item.alignment];
  const acceptLabel = item.kind === "action" ? "Add to my tasks" : item.kind === "goal" ? "Add goal" : "Keep";

  return (
    <article className={`rounded-lg border border-border bg-card p-3 ${decided ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{item.title}</div>
          {item.detail && <p className="mt-0.5 text-sm text-muted">{item.detail}</p>}
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${align.cls}`}>{align.label}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {item.goalTitle && <span className="text-xs">→ {item.goalTitle}</span>}
        {item.impact != null && <Dots n={item.impact} label="Impact" />}
        {item.effort != null && <Dots n={item.effort} label="Effort" />}
        {item.horizon && <span className="text-xs text-muted">{WHEN_LABEL[item.horizon] ?? item.horizon}</span>}
      </div>
      {item.alignmentNote && <p className="mt-1 text-xs text-muted">{item.alignmentNote}</p>}
      {item.quote && <blockquote className="mt-2 border-l-2 border-border pl-2 text-xs italic text-muted">“{item.quote}”</blockquote>}

      {!decided ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {(item.kind === "action" || item.kind === "goal") && (
            <Input id={`due-${item.id}`} type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" className="w-40" />
          )}
          <Button onClick={() => decide.mutate("accept")} disabled={decide.isPending}>
            {acceptLabel}
          </Button>
          {(item.kind === "action" || item.kind === "goal") && (
            <Button variant="outline" onClick={() => decide.mutate("park")} disabled={decide.isPending}>
              Later
            </Button>
          )}
          <Button variant="outline" onClick={() => decide.mutate("dismiss")} disabled={decide.isPending}>
            Dismiss
          </Button>
          {decide.error && <span className="text-xs text-destructive">{(decide.error as Error).message}</span>}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted">
          {item.status === "accepted" ? (item.taskId ? "Added to your tasks" : "Added to goals") : item.status === "parked" ? "Kept for later" : "Dismissed"}
        </p>
      )}
    </article>
  );
}
