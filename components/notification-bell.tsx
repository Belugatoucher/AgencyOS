"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/fetcher";

type Payload = {
  items: { id: string; kind: string; body: Record<string, unknown>; readAt: string | null; createdAt: string }[];
  unread: number;
};

function describe(kind: string, body: Record<string, unknown>): string {
  switch (kind) {
    case "member_invited":
      return `${body.name ?? "Someone"} was invited (${body.role ?? "user"})`;
    case "file_uploaded":
      return `File uploaded: ${body.filename ?? "unknown"}`;
    default:
      return kind.replaceAll("_", " ");
  }
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<Payload>("/api/notifications"),
    refetchInterval: 30_000,
  });
  const markRead = useMutation({
    mutationFn: () => api("/api/notifications", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const unread = data?.unread ?? 0;

  return (
    <div className="relative">
      <button
        aria-label="Notifications"
        onClick={() => {
          setOpen((o) => !o);
          if (!open && unread > 0) markRead.mutate();
        }}
        className="relative rounded-md border border-border bg-card px-2.5 py-1.5 text-sm hover:bg-background"
      >
        🔔
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 rounded-full bg-destructive px-1.5 text-[10px] font-bold text-white">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-lg border border-border bg-card p-2 shadow-lg">
          {data?.items.length ? (
            <ul className="flex flex-col gap-1">
              {data.items.map((n) => (
                <li key={n.id} className="rounded-md p-2 text-sm hover:bg-background">
                  <div>{describe(n.kind, n.body)}</div>
                  <div className="text-xs text-muted">{new Date(n.createdAt).toLocaleString()}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-3 text-sm text-muted">Nothing yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
