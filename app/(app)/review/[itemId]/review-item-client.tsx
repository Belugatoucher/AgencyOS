"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRef, useState } from "react";
import { Badge, Button, Card } from "@/components/ui";
import { api } from "@/lib/fetcher";
import { uploadFile } from "@/lib/upload-client";
import { ReviewPlayer, type ReviewComment } from "@/components/review-player";

type Version = {
  id: string;
  versionNo: number;
  status: string;
  openComments: number;
  openChanges: number;
};
type Detail = { item: { id: string; title: string }; versions: Version[] };

export function ReviewItemClient({ itemId, accountId, title }: { itemId: string; accountId: string; title: string }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const key = ["review-item", itemId];
  const { data } = useQuery({ queryKey: key, queryFn: () => api<Detail>(`/api/review/items/${itemId}`) });

  const addVersion = useMutation({
    mutationFn: async (file: File) => {
      const record = await uploadFile(accountId, file);
      return api<Version>(`/api/review/items/${itemId}/versions`, {
        method: "POST",
        body: JSON.stringify({ fileId: record.id }),
      });
    },
    onSuccess: (v) => {
      setSelected(v.id);
      qc.invalidateQueries({ queryKey: key });
    },
  });

  const share = useMutation({
    mutationFn: () => api<{ url: string }>(`/api/review/items/${itemId}/share`, { method: "POST", body: JSON.stringify({ pin: "1234" }) }),
    onSuccess: (r) => setShareUrl(r.url),
  });

  const versions = data?.versions ?? [];
  const current = selected ?? versions[0]?.id ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/review" className="text-sm text-muted hover:text-foreground">
            ← Review
          </Link>
          <h1 className="text-xl font-semibold">{title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            data-testid="version-file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) addVersion.mutate(f);
              e.target.value = "";
            }}
          />
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={addVersion.isPending}>
            {addVersion.isPending ? "Uploading…" : "Upload version"}
          </Button>
          <Button onClick={() => share.mutate()} data-testid="share-btn">
            Share (PIN 1234)
          </Button>
        </div>
      </div>

      {shareUrl && (
        <p className="rounded-md border border-border bg-card p-2 text-sm">
          Share link (14-day, PIN 1234): <code className="text-accent">{shareUrl}</code>
        </p>
      )}

      <div className="flex flex-wrap gap-2" data-testid="version-chips">
        {versions.map((v) => (
          <button
            key={v.id}
            onClick={() => setSelected(v.id)}
            className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm ${
              current === v.id ? "border-accent" : "border-border"
            }`}
          >
            v{v.versionNo}
            <Badge>{v.status}</Badge>
            {v.openChanges > 0 && <span className="text-xs text-warning">{v.openChanges} changes</span>}
            {v.openComments > 0 && <span className="text-xs text-muted">{v.openComments} open</span>}
          </button>
        ))}
        {versions.length === 0 && <p className="text-sm text-muted">Upload a version to start reviewing.</p>}
      </div>

      {current && <VersionReview versionId={current} itemId={itemId} />}
    </div>
  );
}

function VersionReview({ versionId, itemId }: { versionId: string; itemId: string }) {
  const qc = useQueryClient();
  const { data: media } = useQuery({
    queryKey: ["review-media", versionId],
    queryFn: () => api<{ mime: string; mediaUrl: string | null; hlsUrl: string | null; status: string }>(`/api/review/versions/${versionId}/media`),
  });
  const commentsKey = ["review-comments", versionId];
  const { data: comments } = useQuery({
    queryKey: commentsKey,
    queryFn: () => api<ReviewComment[]>(`/api/review/versions/${versionId}/comments`),
  });

  const addComment = useMutation({
    mutationFn: (body: { body: string; timestampMs: number | null; kind: "note" | "change" }) =>
      api(`/api/review/versions/${versionId}/comments`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: commentsKey }),
  });
  const patchComment = useMutation({
    mutationFn: (v: { id: string; body: Record<string, unknown> }) =>
      api(`/api/review/comments/${v.id}`, { method: "PATCH", body: JSON.stringify(v.body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: commentsKey });
      qc.invalidateQueries({ queryKey: ["review-item", itemId] });
    },
  });
  const approve = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/api/review/versions/${versionId}/approval`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["review-item", itemId] }),
  });
  const toTask = useMutation({
    mutationFn: () => api(`/api/review/versions/${versionId}/changes-to-task`, { method: "POST" }),
  });

  const [approveMsg, setApproveMsg] = useState<string | null>(null);

  return (
    <ReviewPlayer
      media={media ?? null}
      comments={comments ?? []}
      canComment
      canModerate
      onComment={(c) => addComment.mutate(c)}
      onResolve={(id, resolved) => patchComment.mutate({ id, body: { resolved } })}
      onChangeStatus={(id, changeStatus, declineReason) =>
        patchComment.mutate({ id, body: { changeStatus, declineReason } })
      }
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            data-testid="approve-btn"
            onClick={() =>
              approve.mutate(
                { decision: "approved" },
                {
                  onError: (e) => setApproveMsg((e as Error).message),
                  onSuccess: () => setApproveMsg("Approved ✅"),
                },
              )
            }
          >
            Approve
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              approve.mutate(
                { decision: "approved", approveWithExceptions: true },
                { onSuccess: () => setApproveMsg("Approved with exceptions"), onError: (e) => setApproveMsg((e as Error).message) },
              )
            }
          >
            Approve w/ exceptions
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              approve.mutate(
                { decision: "changes_requested" },
                { onSuccess: () => setApproveMsg("Changes requested"), onError: (e) => setApproveMsg((e as Error).message) },
              )
            }
          >
            Request changes
          </Button>
          <Button variant="outline" onClick={() => toTask.mutate(undefined, { onSuccess: () => setApproveMsg("Sent open changes to Tasks") })}>
            Changes → Tasks
          </Button>
          {approveMsg && <span className="text-sm text-muted">{approveMsg}</span>}
        </div>
      }
    />
  );
}
