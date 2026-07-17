"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Button, Card, Input, Select } from "@/components/ui";
import { api } from "@/lib/fetcher";

type Account = { id: string; name: string };
type Item = { id: string; title: string; clientVisible: boolean; createdAt: string };

export function ReviewListClient() {
  const qc = useQueryClient();
  const [accountId, setAccountId] = useState("");
  const [title, setTitle] = useState("");

  const { data: accounts } = useQuery({ queryKey: ["accounts"], queryFn: () => api<Account[]>("/api/accounts") });
  const key = ["review-items", accountId];
  const { data: items } = useQuery({
    queryKey: key,
    queryFn: () => api<Item[]>(`/api/review/items?account=${accountId}`),
    enabled: !!accountId,
  });

  const create = useMutation({
    mutationFn: () => api<Item>("/api/review/items", { method: "POST", body: JSON.stringify({ accountId, title }) }),
    onSuccess: () => {
      setTitle("");
      qc.invalidateQueries({ queryKey: key });
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Review</h1>
      <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} data-testid="review-account">
        <option value="">Select account…</option>
        {accounts?.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </Select>

      {accountId && (
        <>
          <Card title="New review item">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (title.trim()) create.mutate();
              }}
            >
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Q3 Brand Video" className="flex-1" data-testid="review-title" />
              <Button type="submit" disabled={create.isPending} data-testid="review-create">
                Create
              </Button>
            </form>
          </Card>

          <Card title="Items">
            {items?.length ? (
              <ul className="flex flex-col gap-1" data-testid="review-items">
                {items.map((it) => (
                  <li key={it.id}>
                    <Link
                      href={`/review/${it.id}`}
                      className="flex items-center justify-between rounded-md border border-border bg-card p-3 text-sm hover:border-accent"
                    >
                      <span className="font-medium">{it.title}</span>
                      <span className="text-xs text-muted">{new Date(it.createdAt).toLocaleDateString()}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No review items yet.</p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
