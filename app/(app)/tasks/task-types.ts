export const STATUSES = ["backlog", "todo", "in_progress", "in_review", "done"] as const;
export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type Status = (typeof STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];

export const STATUS_LABEL: Record<Status, string> = {
  backlog: "Backlog",
  todo: "To do",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
};

export const PRIORITY_COLOR: Record<Priority, string> = {
  low: "text-muted",
  normal: "text-foreground",
  high: "text-warning",
  urgent: "text-destructive",
};

export type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: Status;
  priority: Priority;
  accountId: string | null;
  projectId: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  dueAt: string | null;
  estimateMinutes: number | null;
  clientVisible: boolean;
  completedAt: string | null;
  createdAt: string;
};

export function dueLabel(dueAt: string | null): { text: string; tone: string } | null {
  if (!dueAt) return null;
  const due = new Date(dueAt);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((due.getTime() - startOfToday.getTime()) / (24 * 60 * 60 * 1000));
  if (days < 0) return { text: `${Math.abs(days)}d overdue`, tone: "text-destructive" };
  if (days === 0) return { text: "Today", tone: "text-warning" };
  if (days === 1) return { text: "Tomorrow", tone: "text-foreground" };
  return { text: due.toLocaleDateString(), tone: "text-muted" };
}
