"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Select } from "@/components/ui";
import { api } from "@/lib/fetcher";
import { TasksNav } from "../tasks-nav";
import { NewTaskForm } from "../new-task-form";
import { dueLabel, PRIORITY_COLOR, STATUS_LABEL, STATUSES, type Status, type TaskRow } from "../task-types";

type Account = { id: string; name: string };
type Project = { id: string; name: string };

export function BoardClient() {
  const qc = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const accountId = params.get("account") ?? "";
  const projectId = params.get("project") ?? "";
  const [dragId, setDragId] = useState<string | null>(null);

  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api<Account[]>("/api/accounts"),
  });
  const { data: projects } = useQuery({
    queryKey: ["projects", accountId],
    queryFn: () => api<Project[]>(`/api/accounts/${accountId}/projects`),
    enabled: !!accountId,
  });

  const query = new URLSearchParams();
  if (accountId) query.set("account", accountId);
  if (projectId) query.set("project", projectId);
  const listKey = ["tasks", "board", accountId, projectId];

  const { data: tasks } = useQuery({
    queryKey: listKey,
    queryFn: () => api<TaskRow[]>(`/api/tasks?${query.toString()}`),
  });

  const move = useMutation({
    mutationFn: (v: { id: string; status: Status }) =>
      api(`/api/tasks/${v.id}`, { method: "PATCH", body: JSON.stringify({ status: v.status }) }),
    // optimistic column move
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: listKey });
      const prev = qc.getQueryData<TaskRow[]>(listKey);
      qc.setQueryData<TaskRow[]>(listKey, (old) =>
        (old ?? []).map((t) => (t.id === v.id ? { ...t, status: v.status } : t)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(listKey, ctx?.prev),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    if (key === "account") next.delete("project");
    router.push(`/tasks/board?${next.toString()}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Tasks</h1>
      <TasksNav />

      <div className="flex flex-wrap gap-2">
        <Select value={accountId} onChange={(e) => setParam("account", e.target.value)}>
          <option value="">All accounts</option>
          {accounts?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        {accountId && (
          <Select value={projectId} onChange={(e) => setParam("project", e.target.value)}>
            <option value="">All projects</option>
            {projects?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        )}
      </div>

      <NewTaskForm
        defaults={accountId ? { accountId, projectId: projectId || undefined } : undefined}
        invalidateKeys={[["tasks"]]}
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-5" data-testid="board">
        {STATUSES.map((status) => {
          const column = (tasks ?? []).filter((t) => t.status === status);
          return (
            <div
              key={status}
              data-testid={`column-${status}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragId) move.mutate({ id: dragId, status });
                setDragId(null);
              }}
              className="flex min-h-32 flex-col gap-2 rounded-lg border border-border bg-background p-2"
            >
              <h2 className="px-1 text-xs font-semibold uppercase text-muted">
                {STATUS_LABEL[status]} <span>({column.length})</span>
              </h2>
              {column.map((t) => {
                const due = dueLabel(t.dueAt);
                return (
                  <div
                    key={t.id}
                    draggable
                    onDragStart={() => setDragId(t.id)}
                    data-testid={`card-${t.id}`}
                    className="cursor-grab rounded-md border border-border bg-card p-2 text-sm active:cursor-grabbing"
                  >
                    <a href={`/tasks/${t.id}`} className="font-medium hover:underline">
                      {t.title}
                    </a>
                    <div className="mt-1 flex items-center justify-between">
                      <span className={`text-xs uppercase ${PRIORITY_COLOR[t.priority]}`}>
                        {t.priority === "normal" ? "" : t.priority}
                      </span>
                      {due && <span className={`text-xs ${due.tone}`}>{due.text}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
