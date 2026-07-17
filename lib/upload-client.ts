import { api } from "@/lib/fetcher";

type Presign =
  | { mode: "single"; key: string; url: string }
  | { mode: "multipart"; key: string; uploadId: string; partSize: number; urls: { partNumber: number; url: string }[] };

type FileRecord = { id: string; filename: string; mime: string; sizeBytes: number };

/**
 * Presign → PUT to R2 → register in the files table. Returns the file record.
 * Shared by Assets (asset registration) and Review (version upload). Bytes go
 * browser→R2 directly; the app never proxies them (CLAUDE.md rule 5).
 */
export async function uploadFile(accountId: string, file: File): Promise<FileRecord> {
  const mime = file.type || "application/octet-stream";
  const presign = await api<Presign>("/api/files/presign", {
    method: "POST",
    body: JSON.stringify({ accountId, filename: file.name, mime, sizeBytes: file.size }),
  });

  let parts: { partNumber: number; etag: string }[] | undefined;
  if (presign.mode === "single") {
    const res = await fetch(presign.url, { method: "PUT", body: file, headers: { "content-type": mime } });
    if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  } else {
    parts = [];
    for (const { partNumber, url } of presign.urls) {
      const start = (partNumber - 1) * presign.partSize;
      const chunk = file.slice(start, start + presign.partSize);
      const res = await fetch(url, { method: "PUT", body: chunk });
      if (!res.ok) throw new Error(`Part ${partNumber} failed (${res.status})`);
      parts.push({ partNumber, etag: (res.headers.get("etag") ?? "").replaceAll('"', "") });
    }
  }

  return api<FileRecord>("/api/files/complete", {
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
}
