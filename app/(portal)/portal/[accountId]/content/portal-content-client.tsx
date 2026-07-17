"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, Button, Card, Input } from "@/components/ui";
import { api } from "@/lib/fetcher";

type Post = {
  id: string;
  channels: string[];
  body: string | null;
  scheduledAt: string | null;
  status: string;
  permalinks: Record<string, string>;
};

// Approved + scheduled + published, read-only except approvals. Rejecting asks
// for line-level {current, proposed} suggestions — never a bare "no" (docs/11).
export function PortalContentClient({ accountId }: { accountId: string }) {
  const qc = useQueryClient();
  const { data: posts } = useQuery({
    queryKey: ["portal-posts", accountId],
    queryFn: () => api<Post[]>(`/api/posts?account=${accountId}`),
  });
  const [suggesting, setSuggesting] = useState<string | null>(null);

  const visible = (posts ?? []).filter((p) =>
    ["in_approval", "approved", "scheduled", "published"].includes(p.status),
  );

  return (
    <Card title="Content">
      {visible.length ? (
        <ul className="flex flex-col gap-2 text-sm" data-testid="portal-posts">
          {visible.map((p) => (
            <li key={p.id} className="rounded-md border border-border bg-card p-3">
              <p className="mb-1 flex items-center gap-2 text-xs text-muted">
                <Badge>{p.status.replace("_", " ")}</Badge>
                <span>{p.channels.join(" · ")}</span>
                {p.scheduledAt && <span>{new Date(p.scheduledAt).toLocaleString()}</span>}
              </p>
              <p className="whitespace-pre-wrap">{p.body ?? "(no copy yet)"}</p>
              {Object.entries(p.permalinks ?? {}).map(([ch, url]) => (
                <a key={ch} href={url} className="mr-2 text-xs text-accent underline" target="_blank" rel="noreferrer">
                  View on {ch} →
                </a>
              ))}
              {p.status === "in_approval" && (
                <ApprovalRow
                  post={p}
                  suggesting={suggesting === p.id}
                  onToggleSuggest={() => setSuggesting(suggesting === p.id ? null : p.id)}
                  onDone={() => {
                    setSuggesting(null);
                    qc.invalidateQueries({ queryKey: ["portal-posts", accountId] });
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No content on the calendar yet.</p>
      )}
    </Card>
  );
}

function ApprovalRow({
  post,
  suggesting,
  onToggleSuggest,
  onDone,
}: {
  post: Post;
  suggesting: boolean;
  onToggleSuggest: () => void;
  onDone: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [proposed, setProposed] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const decide = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/api/posts/${post.id}/approval`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: onDone,
    onError: (e) => setMsg((e as Error).message),
  });

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-border pt-2">
      <div className="flex gap-2">
        <Button data-testid="portal-post-approve" onClick={() => decide.mutate({ decision: "approved" })}>
          Approve
        </Button>
        <Button variant="outline" data-testid="portal-post-suggest" onClick={onToggleSuggest}>
          Request changes
        </Button>
      </div>
      {suggesting && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted">
            Tell us exactly what to change — paste the current line and your proposed wording.
          </p>
          <Input
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            placeholder="Current line"
            data-testid="portal-suggest-current"
          />
          <Input
            value={proposed}
            onChange={(e) => setProposed(e.target.value)}
            placeholder="Proposed wording"
            data-testid="portal-suggest-proposed"
          />
          <Button
            className="self-start"
            disabled={!current.trim() || !proposed.trim() || decide.isPending}
            data-testid="portal-suggest-send"
            onClick={() =>
              decide.mutate({ decision: "rejected", suggestions: [{ current, proposed }] })
            }
          >
            Send change request
          </Button>
        </div>
      )}
      {msg && <p className="text-xs text-warning">{msg}</p>}
    </div>
  );
}
