"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Badge, Button, Card } from "@/components/ui";
import { api } from "@/lib/fetcher";

type FileRow = { id: string; filename: string; mime: string; sizeBytes: number; createdAt: string };

type Presign =
  | { mode: "single"; key: string; url: string }
  | { mode: "multipart"; key: string; uploadId: string; partSize: number; urls: { partNumber: number; url: string }[] };

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

// Browser → R2 direct (presigned); bytes never touch the app server.
async function uploadToR2(file: File, presign: Presign): Promise<{ parts?: { partNumber: number; etag: string }[] }> {
  if (presign.mode === "single") {
    const res = await fetch(presign.url, {
      method: "PUT",
      body: file,
      headers: { "content-type": file.type || "application/octet-stream" },
    });
    if (!res.ok) throw new Error(`Upload failed (${res.status})`);
    return {};
  }
  const parts: { partNumber: number; etag: string }[] = [];
  for (const { partNumber, url } of presign.urls) {
    const start = (partNumber - 1) * presign.partSize;
    const chunk = file.slice(start, start + presign.partSize);
    const res = await fetch(url, { method: "PUT", body: chunk });
    if (!res.ok) throw new Error(`Part ${partNumber} failed (${res.status})`);
    const etag = res.headers.get("etag") ?? "";
    parts.push({ partNumber, etag: etag.replaceAll('"', "") });
  }
  return { parts };
}

export function UploadCard({ accountId, internal }: { accountId: string; internal: boolean }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const key = ["files", accountId];

  const { data: files } = useQuery({
    queryKey: key,
    queryFn: () => api<FileRow[]>(`/api/accounts/${accountId}/files`),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const mime = file.type || "application/octet-stream";
      const presign = await api<Presign>("/api/files/presign", {
        method: "POST",
        body: JSON.stringify({ accountId, filename: file.name, mime, sizeBytes: file.size }),
      });
      const { parts } = await uploadToR2(file, presign);
      return api<FileRow>("/api/files/complete", {
        method: "POST",
        body: JSON.stringify({
          accountId,
          key: presign.key,
          filename: file.name,
          mime,
          sizeBytes: file.size,
          ...(presign.mode === "multipart" ? { uploadId: presign.uploadId, parts } : {}),
        }),
      });
    },
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => setError(e.message),
  });

  return (
    <Card
      title="Files"
      actions={
        internal ? (
          <>
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              data-testid="file-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload.mutate(f);
                e.target.value = "";
              }}
            />
            <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={upload.isPending}>
              {upload.isPending ? "Uploading…" : "Upload file"}
            </Button>
          </>
        ) : undefined
      }
    >
      {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
      {files?.length ? (
        <ul className="flex flex-col gap-1" data-testid="files-list">
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between rounded-md p-2 text-sm hover:bg-background">
              <span>{f.filename}</span>
              <span className="flex items-center gap-2">
                <Badge>{f.mime}</Badge>
                <span className="text-xs text-muted">{formatBytes(f.sizeBytes)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No files yet.</p>
      )}
    </Card>
  );
}
