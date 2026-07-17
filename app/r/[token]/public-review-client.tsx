"use client";

import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, Button, Card, Input } from "@/components/ui";
import { api } from "@/lib/fetcher";
import { ReviewPlayer, type ReviewComment } from "@/components/review-player";

type Version = {
  id: string;
  versionNo: number;
  status: string;
  mime: string;
  mediaUrl: string | null;
  hlsUrl: string | null;
  comments: ReviewComment[];
  approval: { decision: string; guestName: string | null } | null;
};
type Payload =
  | { status: "ok"; item: { id: string; title: string }; canComment: boolean; versions: Version[] }
  | { status: "pin_required" | "expired" | "locked_out" | "not_found" | "unsupported" };

const qc = new QueryClient();

export function PublicReviewClient({ token }: { token: string }) {
  return (
    <QueryClientProvider client={qc}>
      <Inner token={token} />
    </QueryClientProvider>
  );
}

function Inner({ token }: { token: string }) {
  const client = useQueryClient();
  const [pin, setPin] = useState("");
  const [submittedPin, setSubmittedPin] = useState<string | null>(null);
  const [guestName, setGuestName] = useState("");
  const [named, setNamed] = useState(false);

  const key = ["share", token, submittedPin];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () =>
      api<Payload>(`/api/share/${token}${submittedPin ? `?pin=${encodeURIComponent(submittedPin)}` : ""}`),
    retry: false,
  });

  const [selected, setSelected] = useState<string | null>(null);

  const comment = useMutation({
    mutationFn: (v: { versionId: string; body: string; timestampMs: number | null; kind: "note" | "change" }) =>
      api(`/api/review/versions/${v.versionId}/comments`, {
        method: "POST",
        body: JSON.stringify({ shareToken: token, guestName, body: v.body, timestampMs: v.timestampMs, kind: v.kind }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });
  const approve = useMutation({
    mutationFn: (v: { versionId: string; decision: "approved" | "changes_requested" }) =>
      api(`/api/review/versions/${v.versionId}/approval`, {
        method: "POST",
        body: JSON.stringify({ shareToken: token, guestName, decision: v.decision }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });

  if (isLoading) return <p className="text-sm text-muted">Loading…</p>;

  if (!data || data.status !== "ok") {
    const status = data?.status ?? "not_found";
    if (status === "pin_required") {
      return (
        <Card title="Enter PIN">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setSubmittedPin(pin);
            }}
          >
            <Input value={pin} onChange={(e) => setPin(e.target.value)} placeholder="4-digit PIN" maxLength={4} data-testid="pin-input" />
            <Button type="submit" data-testid="pin-submit">
              Unlock
            </Button>
          </form>
          {submittedPin && <p className="mt-2 text-sm text-destructive">That PIN didn&apos;t work.</p>}
        </Card>
      );
    }
    const msg =
      status === "expired"
        ? "This link has expired."
        : status === "locked_out"
          ? "Too many attempts. Try again later."
          : "This link isn't available.";
    return <p className="text-sm text-muted">{msg}</p>;
  }

  const current = data.versions.find((v) => v.id === selected) ?? data.versions[0];
  if (!current) return <p className="text-sm text-muted">No versions to review yet.</p>;

  if (!named && data.canComment) {
    return (
      <Card title={`Review: ${data.item.title}`}>
        <p className="mb-2 text-sm text-muted">Type your name once to comment.</p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (guestName.trim()) setNamed(true);
          }}
        >
          <Input value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Your name" data-testid="guest-name" />
          <Button type="submit" data-testid="guest-continue">
            Continue
          </Button>
        </form>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{data.item.title}</h1>
        {current.approval && <Badge>{current.approval.decision}</Badge>}
      </div>
      <div className="flex flex-wrap gap-2">
        {data.versions.map((v) => (
          <button
            key={v.id}
            onClick={() => setSelected(v.id)}
            className={`rounded-md border px-3 py-1.5 text-sm ${current.id === v.id ? "border-accent" : "border-border"}`}
          >
            v{v.versionNo}
          </button>
        ))}
      </div>
      <ReviewPlayer
        media={{ mime: current.mime, mediaUrl: current.mediaUrl, hlsUrl: current.hlsUrl, status: current.status }}
        comments={current.comments}
        canComment={data.canComment}
        canModerate={false}
        onComment={(c) => comment.mutate({ versionId: current.id, ...c })}
        footer={
          data.canComment ? (
            <div className="flex gap-2">
              <Button data-testid="guest-approve" onClick={() => approve.mutate({ versionId: current.id, decision: "approved" })}>
                Approve
              </Button>
              <Button variant="outline" onClick={() => approve.mutate({ versionId: current.id, decision: "changes_requested" })}>
                Request changes
              </Button>
            </div>
          ) : undefined
        }
      />
    </div>
  );
}
