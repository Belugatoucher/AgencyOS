"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Badge, Button, Select } from "@/components/ui";
import { api } from "@/lib/fetcher";
import { CHANNELS, STATUS_COLOR, type GhostCard, type Post } from "./post-types";
import { PostComposer } from "./post-composer";

type Account = { id: string; name: string };

function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay()); // back to Sunday
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export function CalendarClient() {
  const qc = useQueryClient();
  const [accountId, setAccountId] = useState("");
  const [cursor, setCursor] = useState(() => new Date());
  const [composer, setComposer] = useState<{ postId?: string; day?: string } | null>(null);

  const { data: accounts } = useQuery({ queryKey: ["accounts"], queryFn: () => api<Account[]>("/api/accounts") });

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const days = useMemo(() => monthGrid(year, month), [year, month]);
  const from = days[0]!.toISOString();
  const to = days[days.length - 1]!.toISOString();

  const postsKey = ["posts", accountId, from];
  const { data: posts } = useQuery({
    queryKey: postsKey,
    queryFn: () => {
      const q = new URLSearchParams({ from, to });
      if (accountId) q.set("account", accountId);
      return api<Post[]>(`/api/posts?${q.toString()}`);
    },
  });
  const { data: ghosts } = useQuery({
    queryKey: ["ghosts", accountId, from],
    queryFn: () => api<GhostCard[]>(`/api/content-slots/ghosts?account=${accountId}&from=${from}&to=${to}`),
    enabled: !!accountId, // master view skips ghost cards
  });

  const byDay = useMemo(() => {
    const map = new Map<string, Post[]>();
    for (const p of posts ?? []) {
      if (!p.scheduledAt) continue;
      const key = new Date(p.scheduledAt).toISOString().slice(0, 10);
      (map.get(key) ?? map.set(key, []).get(key)!).push(p);
    }
    return map;
  }, [posts]);
  const ghostsByDay = useMemo(() => {
    const map = new Map<string, GhostCard[]>();
    for (const g of ghosts ?? []) {
      const key = new Date(g.date).toISOString().slice(0, 10);
      (map.get(key) ?? map.set(key, []).get(key)!).push(g);
    }
    return map;
  }, [ghosts]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["posts"] });
    qc.invalidateQueries({ queryKey: ["ghosts"] });
  };
  const shiftMonth = (d: number) => setCursor(new Date(year, month + d, 1));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Calendar</h1>
        <div className="flex items-center gap-2">
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} data-testid="calendar-account">
            <option value="">All accounts (master)</option>
            {accounts?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          <Button variant="outline" onClick={() => shiftMonth(-1)}>
            ←
          </Button>
          <span className="min-w-32 text-center text-sm font-medium">
            {cursor.toLocaleString(undefined, { month: "long", year: "numeric" })}
          </span>
          <Button variant="outline" onClick={() => shiftMonth(1)}>
            →
          </Button>
          {accountId && (
            <Button onClick={() => setComposer({ day: new Date().toISOString() })} data-testid="new-post">
              New post
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border text-xs" data-testid="calendar-grid">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="bg-card p-2 text-center font-semibold text-muted">
            {d}
          </div>
        ))}
        {days.map((d) => {
          const key = d.toISOString().slice(0, 10);
          const inMonth = d.getMonth() === month;
          const dayPosts = byDay.get(key) ?? [];
          const dayGhosts = ghostsByDay.get(key) ?? [];
          return (
            <div
              key={key}
              className={`min-h-24 bg-card p-1 ${inMonth ? "" : "opacity-40"}`}
              onDoubleClick={() => accountId && setComposer({ day: `${key}T12:00:00.000Z` })}
            >
              <div className="mb-1 text-right text-muted">{d.getDate()}</div>
              <div className="flex flex-col gap-1">
                {dayPosts.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setComposer({ postId: p.id })}
                    data-testid={`post-${p.id}`}
                    className={`truncate rounded px-1 py-0.5 text-left ${STATUS_COLOR[p.status] ?? "bg-background"}`}
                  >
                    {p.channels.join("/")}: {(p.body ?? "").slice(0, 24) || "(no body)"}
                  </button>
                ))}
                {dayGhosts.map((g, i) => (
                  <button
                    key={`${g.slotId}-${i}`}
                    onClick={() => setComposer({ day: g.date })}
                    className="truncate rounded border border-dashed border-border px-1 py-0.5 text-left text-muted"
                    title="Content slot — nothing scheduled"
                  >
                    + {g.label ?? g.channels.join("/")}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2 text-xs text-muted">
        {Object.keys(STATUS_COLOR).map((s) => (
          <span key={s} className={`rounded px-2 py-0.5 ${STATUS_COLOR[s]}`}>
            {s}
          </span>
        ))}
        <span className="rounded border border-dashed border-border px-2 py-0.5">ghost = owed slot</span>
      </div>

      {composer && accountId && (
        <PostComposer
          accountId={accountId}
          postId={composer.postId}
          defaultDay={composer.day}
          channels={CHANNELS}
          onClose={() => setComposer(null)}
          onSaved={() => {
            invalidate();
          }}
        />
      )}
      {composer && !accountId && (
        <p className="text-sm text-muted">Pick an account to compose a post.</p>
      )}
    </div>
  );
}
