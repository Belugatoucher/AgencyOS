"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Input, Select } from "@/components/ui";
import { api } from "@/lib/fetcher";
import { PRIORITIES, type TaskRow } from "./task-types";

type Member = { id: string; name: string; email: string; role: string };
type Account = { id: string; name: string };

export function NewTaskForm({
  defaults,
  invalidateKeys,
}: {
  defaults?: { accountId?: string; projectId?: string; status?: string };
  invalidateKeys: unknown[][];
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [priority, setPriority] = useState("normal");
  const [dueAt, setDueAt] = useState("");
  const [accountId, setAccountId] = useState(defaults?.accountId ?? "");
  const [error, setError] = useState<string | null>(null);

  const { data: members } = useQuery({
    queryKey: ["team"],
    queryFn: () => api<Member[]>("/api/team"),
  });
  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api<Account[]>("/api/accounts"),
  });

  const create = useMutation({
    mutationFn: () =>
      api<TaskRow>("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title,
          status: defaults?.status ?? "todo",
          priority,
          assigneeId: assigneeId || null,
          accountId: accountId || null,
          projectId: defaults?.projectId ?? null,
          dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        }),
      }),
    onSuccess: () => {
      setTitle("");
      setDueAt("");
      setError(null);
      invalidateKeys.forEach((key) => qc.invalidateQueries({ queryKey: key }));
    },
    onError: (e) => setError(e.message),
  });

  return (
    <form
      className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) create.mutate();
      }}
    >
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="New task title"
        className="min-w-48 flex-1"
        data-testid="new-task-title"
      />
      <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} data-testid="new-task-assignee">
        <option value="">Unassigned</option>
        {members
          ?.filter((m) => m.role !== "client")
          .map((m) => (
            <option key={m.id} value={m.id}>
              {m.name || m.email}
            </option>
          ))}
      </Select>
      {!defaults?.accountId && (
        <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">No account</option>
          {accounts?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      )}
      <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </Select>
      <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
      <Button type="submit" disabled={create.isPending} data-testid="new-task-submit">
        Add task
      </Button>
      {error && <p className="w-full text-sm text-destructive">{error}</p>}
    </form>
  );
}
