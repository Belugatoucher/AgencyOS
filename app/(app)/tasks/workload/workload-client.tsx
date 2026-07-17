"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetcher";
import { TasksNav } from "../tasks-nav";
import type { TaskRow } from "../task-types";

type Member = { id: string; name: string; email: string; role: string };

// Estimate-sum thresholds for the week (minutes). Green under ~15h, yellow
// under ~30h, red beyond — the "who can take this" signal (docs/04).
function loadColor(minutes: number): { bar: string; label: string } {
  const hours = minutes / 60;
  if (hours <= 15) return { bar: "bg-success", label: "light" };
  if (hours <= 30) return { bar: "bg-warning", label: "full" };
  return { bar: "bg-destructive", label: "overloaded" };
}

export function WorkloadClient() {
  const { data: tasks } = useQuery({
    queryKey: ["tasks", "workload"],
    queryFn: () => api<TaskRow[]>("/api/tasks"),
  });
  const { data: members } = useQuery({
    queryKey: ["team"],
    queryFn: () => api<Member[]>("/api/team"),
  });

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekOut = new Date(startOfToday.getTime() + 7 * 24 * 60 * 60 * 1000);

  const internal = (members ?? []).filter((m) => m.role !== "client");
  const rows = internal.map((m) => {
    const mine = (tasks ?? []).filter(
      (t) => t.assigneeId === m.id && t.status !== "done",
    );
    const thisWeek = mine.filter(
      (t) => t.dueAt && new Date(t.dueAt) >= startOfToday && new Date(t.dueAt) <= weekOut,
    );
    const minutes = thisWeek.reduce((sum, t) => sum + (t.estimateMinutes ?? 0), 0);
    return { member: m, openCount: mine.length, weekCount: thisWeek.length, minutes };
  });

  const maxMinutes = Math.max(60, ...rows.map((r) => r.minutes));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Tasks</h1>
      <TasksNav />
      <p className="text-sm text-muted">
        Estimated hours due this week per person. Green = room to take work, red = overloaded.
      </p>

      <div className="flex flex-col gap-2" data-testid="workload">
        {rows.map((r) => {
          const color = loadColor(r.minutes);
          const hours = (r.minutes / 60).toFixed(1);
          return (
            <div
              key={r.member.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
            >
              <div className="w-40 shrink-0 text-sm font-medium">
                {r.member.name || r.member.email}
              </div>
              <div className="h-4 flex-1 overflow-hidden rounded bg-background">
                <div
                  className={`h-full ${color.bar}`}
                  style={{ width: `${Math.min(100, (r.minutes / maxMinutes) * 100)}%` }}
                />
              </div>
              <div className="w-40 shrink-0 text-right text-xs text-muted">
                {hours}h this week · {r.weekCount} due · {r.openCount} open
              </div>
            </div>
          );
        })}
        {rows.length === 0 && <p className="text-sm text-muted">No team members yet.</p>}
      </div>
    </div>
  );
}
