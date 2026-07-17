"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Badge, Button, Card, Input, Select } from "@/components/ui";
import { api } from "@/lib/fetcher";
import { uploadFile } from "@/lib/upload-client";

type Account = { id: string; name: string };
type Asset = {
  id: string;
  type: string;
  status: string;
  tags: string[] | null;
  filename: string;
  mime: string;
  sizeBytes: number;
  assigneeName: string | null;
  thumbKey: string | null;
};
type Collection = { id: string; name: string; isBrandKit: boolean; isDropbox: boolean };

const TYPES = ["logo", "photo", "video", "raw", "font", "doc", "export"];
const STATUSES = ["draft", "in_review", "approved", "archived"];

export function AssetsClient() {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [accountId, setAccountId] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [q, setQ] = useState("");
  const [uploadType, setUploadType] = useState("photo");
  const [msg, setMsg] = useState<string | null>(null);

  const { data: accounts } = useQuery({ queryKey: ["accounts"], queryFn: () => api<Account[]>("/api/accounts") });

  const query = new URLSearchParams();
  if (accountId) query.set("account", accountId);
  if (typeFilter) query.set("type", typeFilter);
  if (statusFilter) query.set("status", statusFilter);
  if (q) query.set("q", q);
  const assetsKey = ["assets", query.toString()];
  const { data: assets } = useQuery({
    queryKey: assetsKey,
    queryFn: () => api<Asset[]>(`/api/assets?${query.toString()}`),
    enabled: !!accountId,
  });

  const collectionsKey = ["collections", accountId];
  const { data: collections } = useQuery({
    queryKey: collectionsKey,
    queryFn: () => api<Collection[]>(`/api/collections?account=${accountId}`),
    enabled: !!accountId,
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const record = await uploadFile(accountId, file);
      return api<{ asset: Asset; duplicateOf?: string }>("/api/assets", {
        method: "POST",
        body: JSON.stringify({ accountId, fileId: record.id, type: uploadType }),
      });
    },
    onSuccess: (r) => {
      setMsg(r.duplicateOf ? "Uploaded — a duplicate of an existing asset in this account." : "Uploaded.");
      qc.invalidateQueries({ queryKey: ["assets"] });
    },
    onError: (e) => setMsg(e.message),
  });

  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: string }) =>
      api(`/api/assets/${v.id}`, { method: "PATCH", body: JSON.stringify({ status: v.status }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assets"] }),
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Assets</h1>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} data-testid="assets-account">
          <option value="">Select account…</option>
          {accounts?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        {accountId && (
          <>
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">All types</option>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search filename/tag" />
          </>
        )}
      </div>

      {accountId && (
        <div className="grid gap-4 md:grid-cols-[1fr_240px]">
          <Card
            title="Library"
            actions={
              <span className="flex items-center gap-2">
                <Select value={uploadType} onChange={(e) => setUploadType(e.target.value)}>
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
                <input
                  ref={inputRef}
                  type="file"
                  className="hidden"
                  data-testid="asset-file"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) upload.mutate(f);
                    e.target.value = "";
                  }}
                />
                <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={upload.isPending}>
                  {upload.isPending ? "Uploading…" : "Upload asset"}
                </Button>
              </span>
            }
          >
            {msg && <p className="mb-2 text-sm text-muted">{msg}</p>}
            {assets?.length ? (
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4" data-testid="asset-grid">
                {assets.map((a) => (
                  <div key={a.id} className="rounded-md border border-border bg-card p-2 text-sm">
                    <div className="mb-1 flex h-20 items-center justify-center rounded bg-background text-2xl">
                      {a.mime.startsWith("image/") ? "🖼️" : a.mime.startsWith("video/") ? "🎬" : "📄"}
                    </div>
                    <div className="truncate font-medium" title={a.filename}>
                      {a.filename}
                    </div>
                    <div className="mt-1 flex items-center justify-between">
                      <Badge>{a.type}</Badge>
                      <Select
                        value={a.status}
                        onChange={(e) => setStatus.mutate({ id: a.id, status: e.target.value })}
                        className="text-xs"
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">No assets. Upload one above.</p>
            )}
          </Card>

          <CollectionsPanel accountId={accountId} collections={collections ?? []} />
        </div>
      )}
    </div>
  );
}

function CollectionsPanel({ accountId, collections }: { accountId: string; collections: { id: string; name: string; isBrandKit: boolean }[] }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [brandKit, setBrandKit] = useState(false);
  const create = useMutation({
    mutationFn: () =>
      api("/api/collections", {
        method: "POST",
        body: JSON.stringify({ accountId, name, isBrandKit: brandKit }),
      }),
    onSuccess: () => {
      setName("");
      qc.invalidateQueries({ queryKey: ["collections", accountId] });
    },
  });
  return (
    <Card title="Collections">
      <form
        className="mb-3 flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New collection" data-testid="collection-name" />
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={brandKit} onChange={(e) => setBrandKit(e.target.checked)} /> Brand Kit
        </label>
        <Button type="submit" variant="outline" data-testid="collection-submit">
          Create
        </Button>
      </form>
      <ul className="flex flex-col gap-1 text-sm" data-testid="collections-list">
        {collections.map((c) => (
          <li key={c.id} className="flex items-center justify-between rounded-md p-2 hover:bg-background">
            <span>{c.name}</span>
            {c.isBrandKit && <Badge>brand kit</Badge>}
          </li>
        ))}
        {collections.length === 0 && <li className="text-muted">None yet.</li>}
      </ul>
    </Card>
  );
}
