"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/fetcher";

type Hit = { kind: string; id: string; title: string; sub: string | null; href: string };

const KIND_ICON: Record<string, string> = {
  task: "☑️",
  lead: "🧲",
  asset: "🖼️",
  meeting: "📝",
  post: "📆",
  review: "🎬",
  account: "🏢",
};

// Search-everywhere bar (roadmap wk10): debounced dropdown over /api/search.
export function GlobalSearch() {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const { data: hits } = useQuery({
    queryKey: ["global-search", debounced],
    queryFn: () => api<Hit[]>(`/api/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2,
  });

  return (
    <div className="relative" ref={boxRef}>
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search everything…"
        data-testid="global-search"
        className="w-44 rounded-md border border-border bg-card px-3 py-1 text-sm outline-none focus:w-64 focus:ring-2 focus:ring-accent transition-all"
      />
      {open && debounced.length >= 2 && (
        <div
          className="absolute right-0 z-50 mt-1 max-h-96 w-80 overflow-auto rounded-md border border-border bg-card shadow-lg"
          data-testid="global-search-results"
        >
          {hits?.length ? (
            hits.map((h) => (
              <Link
                key={`${h.kind}-${h.id}`}
                href={h.href}
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 border-b border-border p-2 text-sm last:border-0 hover:bg-background"
              >
                <span>{KIND_ICON[h.kind] ?? "•"}</span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{h.title}</span>
                  {h.sub && <span className="block truncate text-xs text-muted">{h.sub}</span>}
                </span>
              </Link>
            ))
          ) : (
            <p className="p-3 text-sm text-muted">No matches.</p>
          )}
        </div>
      )}
    </div>
  );
}
