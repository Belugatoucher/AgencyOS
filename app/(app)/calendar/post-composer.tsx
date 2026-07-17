"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, Button, Card, Input } from "@/components/ui";
import { api } from "@/lib/fetcher";
import type { Post, ValidationIssue } from "./post-types";

type Asset = { id: string; type: string; filename: string };
type Draft = {
  variants: { channel: string; body: string; hook_alternatives: string[]; media_direction?: string; hashtags: string[] }[];
  angle_note: string;
};

export function PostComposer({
  accountId,
  postId,
  defaultDay,
  channels: allChannels,
  onClose,
  onSaved,
}: {
  accountId: string;
  postId?: string;
  defaultDay?: string;
  channels: readonly string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const { data: existing } = useQuery({
    queryKey: ["post", postId],
    queryFn: () => api<Post>(`/api/posts/${postId}`),
    enabled: !!postId,
  });
  const { data: assets } = useQuery({
    queryKey: ["assets", `account=${accountId}`],
    queryFn: () => api<Asset[]>(`/api/assets?account=${accountId}`),
  });

  const [channels, setChannels] = useState<string[]>(existing?.channels ?? []);
  const [body, setBody] = useState(existing?.body ?? "");
  const [overrides, setOverrides] = useState<Record<string, { body?: string }>>(existing?.channelOverrides ?? {});
  const [media, setMedia] = useState<string[]>(existing?.media ?? []);
  const [scheduledAt, setScheduledAt] = useState(
    existing?.scheduledAt ? existing.scheduledAt.slice(0, 16) : defaultDay ? defaultDay.slice(0, 16) : "",
  );
  const [approvalRequired, setApprovalRequired] = useState(existing?.approvalRequired ?? true);
  const [aiSource, setAiSource] = useState("");
  const [issues, setIssues] = useState<ValidationIssue[]>(existing?.issues ?? []);
  const [msg, setMsg] = useState<string | null>(null);
  const status = existing?.status ?? "draft";

  // sync when existing loads
  if (existing && channels.length === 0 && existing.channels.length > 0 && body === "") {
    setChannels(existing.channels);
    setBody(existing.body ?? "");
    setOverrides(existing.channelOverrides ?? {});
    setMedia(existing.media ?? []);
    setApprovalRequired(existing.approvalRequired);
    setIssues(existing.issues);
  }

  function toggleChannel(ch: string) {
    setChannels((c) => (c.includes(ch) ? c.filter((x) => x !== ch) : [...c, ch]));
  }

  const payload = () => ({
    channels,
    body: body || null,
    channelOverrides: overrides,
    media,
    scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
    approvalRequired,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (postId) return api<Post>(`/api/posts/${postId}`, { method: "PATCH", body: JSON.stringify(payload()) });
      return api<Post>("/api/posts", { method: "POST", body: JSON.stringify({ accountId, ...payload() }) });
    },
    onSuccess: (p) => {
      setIssues(p.issues);
      setMsg("Saved.");
      qc.invalidateQueries({ queryKey: ["post", p.id] });
      onSaved();
    },
    onError: (e) => setMsg((e as Error).message),
  });

  const transition = useMutation({
    mutationFn: (nextStatus: string) =>
      api<Post>(`/api/posts/${postId}`, { method: "PATCH", body: JSON.stringify({ ...payload(), status: nextStatus }) }),
    onSuccess: (p) => {
      setMsg(`Now ${p.status}.`);
      setIssues(p.issues);
      onSaved();
    },
    onError: (e) => setMsg((e as Error).message),
  });

  const decide = useMutation({
    mutationFn: (decision: "approved" | "rejected") =>
      api(`/api/posts/${postId}/approval`, { method: "POST", body: JSON.stringify({ decision }) }),
    onSuccess: () => {
      setMsg("Decision recorded.");
      onSaved();
    },
  });

  const aiDraft = useMutation({
    mutationFn: () =>
      api<Draft>(`/api/posts/${postId ?? "new"}/ai-draft`, {
        method: "POST",
        body: JSON.stringify({ channels: channels.length ? channels : ["linkedin"], source: aiSource }),
      }),
    onSuccess: (d) => {
      // pre-fill per-channel overrides from variants (human still reviews)
      const next = { ...overrides };
      for (const v of d.variants) next[v.channel] = { body: v.body };
      setOverrides(next);
      setMsg(`AI drafted ${d.variants.length} variant(s). ${d.angle_note}`);
    },
    onError: (e) => setMsg((e as Error).message),
  });

  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/30" onClick={onClose}>
      <aside className="h-full w-full max-w-lg overflow-y-auto border-l border-border bg-card p-4" onClick={(e) => e.stopPropagation()} data-testid="composer">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{postId ? "Edit post" : "New post"}</h2>
          <span className="flex items-center gap-2">
            <Badge>{status}</Badge>
            <button onClick={onClose} className="text-muted hover:text-foreground">
              ✕
            </button>
          </span>
        </div>

        <div className="flex flex-col gap-3 text-sm">
          <div>
            <span className="text-xs text-muted">Channels</span>
            <div className="mt-1 flex flex-wrap gap-1">
              {allChannels.map((ch) => (
                <button
                  key={ch}
                  onClick={() => toggleChannel(ch)}
                  data-testid={`channel-${ch}`}
                  className={`rounded-md border px-2 py-1 text-xs ${channels.includes(ch) ? "border-accent bg-accent/10" : "border-border"}`}
                >
                  {ch}
                </button>
              ))}
            </div>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Body (default)</span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} className="rounded-md border border-border bg-card px-3 py-2" data-testid="post-body" />
          </label>

          {channels.map((ch) => (
            <label key={ch} className="flex flex-col gap-1">
              <span className="text-xs text-muted">{ch} override (optional)</span>
              <textarea
                value={overrides[ch]?.body ?? ""}
                onChange={(e) => setOverrides((o) => ({ ...o, [ch]: { body: e.target.value } }))}
                rows={2}
                className="rounded-md border border-border bg-card px-3 py-1.5"
              />
            </label>
          ))}

          <div>
            <span className="text-xs text-muted">Media from library</span>
            <div className="mt-1 flex flex-wrap gap-1">
              {assets?.slice(0, 12).map((a) => (
                <button
                  key={a.id}
                  onClick={() => setMedia((m) => (m.includes(a.id) ? m.filter((x) => x !== a.id) : [...m, a.id]))}
                  className={`rounded-md border px-2 py-1 text-xs ${media.includes(a.id) ? "border-accent bg-accent/10" : "border-border"}`}
                >
                  {a.filename.slice(0, 14)}
                </button>
              ))}
              {!assets?.length && <span className="text-xs text-muted">No assets in this account.</span>}
            </div>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Scheduled time</span>
            <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} data-testid="post-schedule" />
          </label>

          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={approvalRequired} onChange={(e) => setApprovalRequired(e.target.checked)} />
            Requires approval before publishing
          </label>

          {issues.length > 0 && (
            <div className="rounded-md border border-warning/30 bg-warning/5 p-2 text-xs text-warning" data-testid="issues">
              {issues.map((i, n) => (
                <div key={n}>
                  {i.channel}: {i.message}
                </div>
              ))}
            </div>
          )}

          <Card title="Draft with AI">
            <textarea value={aiSource} onChange={(e) => setAiSource(e.target.value)} rows={2} placeholder="Paste a transcript excerpt, blog text, or bullets" className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm" />
            <Button variant="outline" className="mt-2" disabled={!aiSource.trim() || aiDraft.isPending} onClick={() => aiDraft.mutate()}>
              {aiDraft.isPending ? "Drafting…" : "Draft variants"}
            </Button>
          </Card>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="save-post">
              Save
            </Button>
            {postId && approvalRequired && status !== "approved" && (
              <Button variant="outline" onClick={() => transition.mutate("in_approval")}>
                Request approval
              </Button>
            )}
            {postId && (status === "in_approval" || (!approvalRequired && status === "draft")) && (
              <>
                <Button variant="outline" onClick={() => decide.mutate("approved")} data-testid="approve-post">
                  Approve
                </Button>
                <Button variant="outline" onClick={() => decide.mutate("rejected")}>
                  Reject
                </Button>
              </>
            )}
            {postId && (status === "approved" || !approvalRequired) && (
              <Button variant="outline" onClick={() => transition.mutate("scheduled")} data-testid="schedule-post">
                Schedule
              </Button>
            )}
          </div>
          {msg && <p className="text-sm text-muted">{msg}</p>}
        </div>
      </aside>
    </div>
  );
}
