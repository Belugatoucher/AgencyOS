"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Badge, Button, Card, Input, Select } from "@/components/ui";
import { api } from "@/lib/fetcher";
import { uploadFile } from "@/lib/upload-client";

type Account = { id: string; name: string };
type Meeting = { id: string; title: string; occurredAt: string; status: string; accountId: string | null };
type SearchHit = { meetingId: string; title: string; occurredAt: string; snippet: string };

export function NotesListClient() {
  const qc = useQueryClient();
  const [accountId, setAccountId] = useState("");
  const [title, setTitle] = useState("");
  const [q, setQ] = useState("");
  const [submittedQ, setSubmittedQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const { data: accounts } = useQuery({ queryKey: ["accounts"], queryFn: () => api<Account[]>("/api/accounts") });
  const key = ["meetings", accountId];
  const { data: meetings } = useQuery({
    queryKey: key,
    queryFn: () => api<Meeting[]>(`/api/meetings${accountId ? `?account=${accountId}` : ""}`),
  });
  const { data: hits } = useQuery({
    queryKey: ["meeting-search", submittedQ],
    queryFn: () => api<SearchHit[]>(`/api/meetings/search?q=${encodeURIComponent(submittedQ)}`),
    enabled: submittedQ.length > 0,
  });

  const createAndUpload = useMutation({
    mutationFn: async (file: File | null) => {
      const meeting = await api<Meeting>("/api/meetings", {
        method: "POST",
        body: JSON.stringify({ title, accountId: accountId || null }),
      });
      if (file && accountId) {
        setBusy("Uploading audio…");
        const record = await uploadFile(accountId, file);
        await api(`/api/meetings/${meeting.id}/audio`, { method: "POST", body: JSON.stringify({ fileId: record.id }) });
      }
      return meeting;
    },
    onSuccess: () => {
      setTitle("");
      setBusy(null);
      qc.invalidateQueries({ queryKey: ["meetings"] });
    },
    onError: (e) => setBusy((e as Error).message),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Notes</h1>
        <Link href="/record" className="text-sm text-accent underline">
          Record in person →
        </Link>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmittedQ(q);
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search across all transcripts" className="flex-1" data-testid="notes-search" />
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>
      {submittedQ && (
        <Card title={`Results for "${submittedQ}"`}>
          {hits?.length ? (
            <ul className="flex flex-col gap-1 text-sm">
              {hits.map((h) => (
                <li key={h.meetingId}>
                  <Link href={`/notes/${h.meetingId}`} className="block rounded-md p-2 hover:bg-background">
                    <span className="font-medium text-accent">{h.title}</span>
                    <span className="ml-2 text-muted" dangerouslySetInnerHTML={{ __html: h.snippet }} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No transcript matches.</p>
          )}
        </Card>
      )}

      <Card title="New meeting">
        <div className="flex flex-wrap gap-2">
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} data-testid="notes-account">
            <option value="">No account</option>
            {accounts?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Meeting title" className="flex-1" data-testid="meeting-title" />
          <Button
            disabled={!title.trim() || createAndUpload.isPending}
            onClick={() => createAndUpload.mutate(null)}
            data-testid="meeting-create"
          >
            Create
          </Button>
          <label className="cursor-pointer rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-background">
            Create + upload audio
            <input
              type="file"
              accept="audio/*,video/*"
              className="hidden"
              data-testid="meeting-audio"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f && title.trim()) createAndUpload.mutate(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {busy && <p className="mt-2 text-sm text-muted">{busy}</p>}
      </Card>

      <Card title="Meetings">
        {meetings?.length ? (
          <ul className="flex flex-col gap-1" data-testid="meetings-list">
            {meetings.map((m) => (
              <li key={m.id}>
                <Link
                  href={`/notes/${m.id}`}
                  className="flex items-center justify-between rounded-md border border-border bg-card p-3 text-sm hover:border-accent"
                >
                  <span className="font-medium">{m.title}</span>
                  <span className="flex items-center gap-2">
                    <Badge>{m.status}</Badge>
                    <span className="text-xs text-muted">{new Date(m.occurredAt).toLocaleDateString()}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No meetings yet.</p>
        )}
      </Card>
    </div>
  );
}
