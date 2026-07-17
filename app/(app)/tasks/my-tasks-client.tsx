"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Badge } from "@/components/ui";
import { api } from "@/lib/fetcher";
import { TasksNav } from "./tasks-nav";
import { NewTaskForm } from "./new-task-form";
import { dueLabel, PRIORITY_COLOR, STATUS_LABEL, type TaskRow } from "./task-types";

function TaskLine({ t }: { t: TaskRow }) {
  const due = dueLabel(t.dueAt);
  return (
    <li>
      <Link
        href={`/tasks/${t.id}`}
        className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3 text-sm hover:border-accent"
      >
        <span className="flex items-center gap-2">
          <span className={`text-xs font-semibold uppercase ${PRIORITY_COLOR[t.priority]}`}>
            {t.priority === "normal" ? "" : t.priority}
          </span>
          <span>{t.title}</span>
        </span>
        <span className="flex items-center gap-2">
          {due && <span className={`text-xs ${due.tone}`}>{due.text}</span>}
          <Badge>{STATUS_LABEL[t.status]}</Badge>
        </span>
      </Link>
    </li>
  );
}

function Bucket({ title, tasks }: { title: string; tasks: TaskRow[] }) {
  if (tasks.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-muted">
        {title} <span className="text-muted">({tasks.length})</span>
      </h2>
      <ul className="flex flex-col gap-1">
        {tasks.map((t) => (
          <TaskLine key={t.id} t={t} />
        ))}
      </ul>
    </section>
  );
}

export function MyTasksClient({ viewerId }: { viewerId: string }) {
  // One query for all my open tasks; bucket client-side so the "new task"
  // invalidation refreshes every section at once.
  const { data: tasks, isLoading } = useQuery({
    queryKey: ["tasks", "mine", viewerId],
    queryFn: () => api<TaskRow[]>(`/api/tasks?assignee=${viewerId}`),
  });

  const open = (tasks ?? []).filter((t) => t.status !== "done");
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
  const weekOut = new Date(startOfToday.getTime() + 7 * 24 * 60 * 60 * 1000);

  const overdue = open.filter((t) => t.dueAt && new Date(t.dueAt) < startOfToday);
  const today = open.filter(
    (t) => t.dueAt && new Date(t.dueAt) >= startOfToday && new Date(t.dueAt) < endOfToday,
  );
  const week = open.filter(
    (t) => t.dueAt && new Date(t.dueAt) >= endOfToday && new Date(t.dueAt) <= weekOut,
  );
  const later = open.filter(
    (t) => !t.dueAt || new Date(t.dueAt) > weekOut,
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Tasks</h1>
      <TasksNav />
      <NewTaskForm invalidateKeys={[["tasks"]]} />

      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : open.length === 0 ? (
        <p className="text-sm text-muted">Nothing assigned to you. Enjoy it.</p>
      ) : (
        <div className="flex flex-col gap-5">
          <Bucket title="Overdue" tasks={overdue} />
          <Bucket title="Today" tasks={today} />
          <Bucket title="This week" tasks={week} />
          <Bucket title="Later / no due date" tasks={later} />
        </div>
      )}
    </div>
  );
}
