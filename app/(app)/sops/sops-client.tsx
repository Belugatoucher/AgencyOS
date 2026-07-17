"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, Button, Card, Input, Select } from "@/components/ui";
import { api } from "@/lib/fetcher";

type Sop = {
  id: string;
  title: string;
  category: string;
  tags: string[];
  body: string;
  status: string;
  version: number;
  reviewEveryDays: number;
};

const CATEGORIES = ["client_mgmt", "creative", "media_buying", "sales", "ops", "tools"];

export function SopsClient() {
  const qc = useQueryClient();
  const [category, setCategory] = useState("");
  const [editing, setEditing] = useState<Sop | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: sops } = useQuery({
    queryKey: ["sops", category],
    queryFn: () => api<Sop[]>(`/api/sops${category ? `?category=${category}` : ""}`),
  });

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "publish" | "review" }) =>
      api(`/api/sops/${id}/${action}`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sops"] }),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">SOP Library</h1>
        <div className="flex gap-2">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.replace("_", " ")}
              </option>
            ))}
          </Select>
          <Button onClick={() => { setCreating(true); setEditing(null); }} data-testid="sop-new">
            New SOP
          </Button>
        </div>
      </div>

      {(creating || editing) && (
        <SopEditor
          sop={editing}
          onDone={() => {
            setCreating(false);
            setEditing(null);
            qc.invalidateQueries({ queryKey: ["sops"] });
          }}
        />
      )}

      <Card title="Library">
        {sops?.length ? (
          <ul className="flex flex-col gap-1 text-sm" data-testid="sops-list">
            {sops.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-card p-3">
                <button className="min-w-0 text-left" onClick={() => { setEditing(s); setCreating(false); }}>
                  <span className="font-medium">{s.title}</span>
                  <span className="ml-2 text-xs text-muted">{s.category.replace("_", " ")} · v{s.version}</span>
                </button>
                <span className="flex items-center gap-2">
                  {s.status === "needs_review" && <Badge>⚠️ stale</Badge>}
                  <Badge>{s.status.replace("_", " ")}</Badge>
                  {s.status === "draft" || s.status === "needs_review" ? (
                    s.status === "needs_review" ? (
                      <Button variant="outline" onClick={() => act.mutate({ id: s.id, action: "review" })} data-testid="sop-mark-reviewed">
                        Still accurate
                      </Button>
                    ) : (
                      <Button variant="outline" onClick={() => act.mutate({ id: s.id, action: "publish" })} data-testid="sop-publish">
                        Publish
                      </Button>
                    )
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No SOPs yet — write the first one.</p>
        )}
      </Card>
    </div>
  );
}

function SopEditor({ sop, onDone }: { sop: Sop | null; onDone: () => void }) {
  const [title, setTitle] = useState(sop?.title ?? "");
  const [category, setCategory] = useState(sop?.category ?? "ops");
  const [tags, setTags] = useState(sop?.tags.join(", ") ?? "");
  const [body, setBody] = useState(sop?.body ?? "# Title\n\n## Steps\n\n1. ");
  const [msg, setMsg] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        title,
        category,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        body,
      };
      return sop
        ? api(`/api/sops/${sop.id}`, { method: "PATCH", body: JSON.stringify(payload) })
        : api("/api/sops", { method: "POST", body: JSON.stringify(payload) });
    },
    onSuccess: onDone,
    onError: (e) => setMsg((e as Error).message),
  });

  return (
    <Card title={sop ? `Edit: ${sop.title}` : "New SOP"}>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="flex-1" data-testid="sop-title" />
          <Select value={category} onChange={(e) => setCategory(e.target.value)} data-testid="sop-category">
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.replace("_", " ")}
              </option>
            ))}
          </Select>
          <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tags, comma, separated" className="w-56" />
        </div>
        <textarea
          className="min-h-64 rounded-md border border-border bg-card px-3 py-1.5 font-mono text-sm outline-none focus:ring-2 focus:ring-accent"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          data-testid="sop-body"
        />
        <div className="flex items-center gap-2">
          <Button disabled={!title.trim() || !body.trim() || save.isPending} onClick={() => save.mutate()} data-testid="sop-save">
            Save draft
          </Button>
          <span className="text-xs text-muted">Publishing snapshots a version and indexes it for the Notebook.</span>
          {msg && <span className="text-xs text-warning">{msg}</span>}
        </div>
      </div>
    </Card>
  );
}
