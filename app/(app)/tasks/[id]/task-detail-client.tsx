"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Badge, Button, Card, Input, Select } from "@/components/ui";
import { api } from "@/lib/fetcher";
import { PRIORITIES, STATUS_LABEL, STATUSES, type Priority, type Status } from "../task-types";

type Detail = {
  task: {
    id: string;
    title: string;
    description: string | null;
    status: Status;
    priority: Priority;
    accountId: string | null;
    assigneeId: string | null;
    dueAt: string | null;
    clientVisible: boolean;
  };
  checklist: { id: string; label: string; done: boolean; position: number }[];
  comments: {
    id: string;
    body: string;
    authorId: string;
    authorName: string;
    parentId: string | null;
    createdAt: string;
  }[];
};

type Member = { id: string; name: string; email: string; role: string };

export function TaskDetailClient({
  taskId,
  canEdit,
  viewerId,
}: {
  taskId: string;
  canEdit: boolean;
  viewerId: string;
}) {
  const qc = useQueryClient();
  const key = ["task", taskId];
  const [warning, setWarning] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => api<Detail>(`/api/tasks/${taskId}`),
  });
  const { data: members } = useQuery({
    queryKey: ["team"],
    queryFn: () => api<Member[]>("/api/team"),
    enabled: canEdit,
  });

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<{ task: unknown; checklistWarning?: string }>(`/api/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: (res) => {
      setWarning(res.checklistWarning ?? null);
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const [newItem, setNewItem] = useState("");
  const addItem = useMutation({
    mutationFn: () =>
      api(`/api/tasks/${taskId}/checklist`, { method: "POST", body: JSON.stringify({ label: newItem }) }),
    onSuccess: () => {
      setNewItem("");
      qc.invalidateQueries({ queryKey: key });
    },
  });
  const toggleItem = useMutation({
    mutationFn: (v: { itemId: string; done: boolean }) =>
      api(`/api/tasks/${taskId}/checklist/${v.itemId}`, {
        method: "PATCH",
        body: JSON.stringify({ done: v.done }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const [comment, setComment] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const addComment = useMutation({
    mutationFn: () =>
      api(`/api/tasks/${taskId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: comment, parentId: replyTo }),
      }),
    onSuccess: () => {
      setComment("");
      setReplyTo(null);
      qc.invalidateQueries({ queryKey: key });
    },
  });

  if (isLoading || !data) return <p className="text-sm text-muted">Loading…</p>;
  const { task, checklist, comments } = data;
  const topLevel = comments.filter((c) => !c.parentId);
  const repliesOf = (id: string) => comments.filter((c) => c.parentId === id);

  return (
    <div className="flex flex-col gap-4">
      <Link href="/tasks" className="text-sm text-muted hover:text-foreground">
        ← Tasks
      </Link>
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-xl font-semibold">{task.title}</h1>
        {task.clientVisible && <Badge>client-visible</Badge>}
      </div>

      {warning && (
        <p className="rounded-md border border-warning/30 bg-warning/5 p-2 text-sm text-warning">
          {warning}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Status">
          <Select
            value={task.status}
            disabled={!canEdit}
            onChange={(e) => patch.mutate({ status: e.target.value })}
            data-testid="task-status"
            className="w-full"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </Card>
        <Card title="Priority">
          <Select
            value={task.priority}
            disabled={!canEdit}
            onChange={(e) => patch.mutate({ priority: e.target.value })}
            className="w-full"
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </Card>
        <Card title="Assignee">
          {canEdit ? (
            <Select
              value={task.assigneeId ?? ""}
              onChange={(e) => patch.mutate({ assigneeId: e.target.value || null })}
              data-testid="task-assignee"
              className="w-full"
            >
              <option value="">Unassigned</option>
              {members
                ?.filter((m) => m.role !== "client")
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name || m.email}
                  </option>
                ))}
            </Select>
          ) : (
            <p className="text-sm text-muted">
              {members?.find((m) => m.id === task.assigneeId)?.name ?? "—"}
            </p>
          )}
        </Card>
      </div>

      <Card title="Checklist">
        <ul className="flex flex-col gap-1" data-testid="checklist">
          {checklist.map((item) => (
            <li key={item.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={item.done}
                disabled={!canEdit}
                onChange={(e) => toggleItem.mutate({ itemId: item.id, done: e.target.checked })}
              />
              <span className={item.done ? "text-muted line-through" : ""}>{item.label}</span>
            </li>
          ))}
        </ul>
        {canEdit && (
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (newItem.trim()) addItem.mutate();
            }}
          >
            <Input
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              placeholder="Add checklist item"
              className="flex-1"
              data-testid="checklist-input"
            />
            <Button type="submit" variant="outline">
              Add
            </Button>
          </form>
        )}
      </Card>

      {canEdit && (
        <Card title="Comments">
          <ul className="mb-3 flex flex-col gap-2" data-testid="comments">
            {topLevel.map((c) => (
              <li key={c.id} className="text-sm">
                <div className="rounded-md bg-background p-2">
                  <div className="text-xs text-muted">
                    {c.authorName} · {new Date(c.createdAt).toLocaleString()}
                  </div>
                  <div>{c.body}</div>
                  <button
                    className="mt-1 text-xs text-muted hover:text-foreground"
                    onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}
                  >
                    {replyTo === c.id ? "Cancel reply" : "Reply"}
                  </button>
                </div>
                {repliesOf(c.id).length > 0 && (
                  <ul className="ml-4 mt-1 flex flex-col gap-1 border-l border-border pl-2">
                    {repliesOf(c.id).map((r) => (
                      <li key={r.id} className="rounded-md bg-background p-2">
                        <div className="text-xs text-muted">
                          {r.authorName} · {new Date(r.createdAt).toLocaleString()}
                        </div>
                        <div>{r.body}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (comment.trim()) addComment.mutate();
            }}
          >
            {replyTo && <p className="text-xs text-muted">Replying to a comment…</p>}
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Comment — @email to notify someone"
              rows={2}
              className="rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
              data-testid="comment-input"
            />
            <div>
              <Button type="submit" disabled={addComment.isPending} data-testid="comment-submit">
                Comment
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
