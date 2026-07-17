"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Badge, Button, Card, Input } from "@/components/ui";
import { api } from "@/lib/fetcher";

type Account = { id: string; name: string; timezone: string; createdAt: string };

export function AccountsClient({ canCreate }: { canCreate: boolean }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: accounts, isLoading } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api<Account[]>("/api/accounts"),
  });

  const create = useMutation({
    mutationFn: (body: { name: string }) =>
      api<Account>("/api/accounts", { method: "POST", body: JSON.stringify(body) }),
    // optimistic add, reconciled by invalidation (CLAUDE.md rule 7)
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: ["accounts"] });
      const previous = qc.getQueryData<Account[]>(["accounts"]);
      qc.setQueryData<Account[]>(["accounts"], (old) => [
        { id: `optimistic-${Date.now()}`, name: body.name, timezone: "", createdAt: new Date().toISOString() },
        ...(old ?? []),
      ]);
      return { previous };
    },
    onError: (e, _body, ctx) => {
      qc.setQueryData(["accounts"], ctx?.previous);
      setError(e.message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
    onSuccess: () => {
      setName("");
      setError(null);
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Accounts</h1>
      </div>

      {canCreate && (
        <Card>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) create.mutate({ name: name.trim() });
            }}
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New client account name"
              className="flex-1"
              data-testid="new-account-name"
            />
            <Button type="submit" disabled={create.isPending}>
              Create account
            </Button>
          </form>
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        </Card>
      )}

      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : accounts?.length ? (
        <ul className="flex flex-col gap-2" data-testid="accounts-list">
          {accounts.map((a) => (
            <li key={a.id}>
              <Link
                href={`/accounts/${a.id}`}
                className="flex items-center justify-between rounded-lg border border-border bg-card p-4 hover:border-accent"
              >
                <span className="font-medium">{a.name}</span>
                <Badge>{a.timezone || "—"}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No accounts yet.</p>
      )}
    </div>
  );
}
