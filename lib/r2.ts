import { S3Client } from "@aws-sdk/client-s3";

// R2 is S3-compatible. R2_ENDPOINT override lets local dev point at MinIO.
export function r2Client(): S3Client {
  const endpoint =
    process.env.R2_ENDPOINT ||
    `https://${process.env.R2_ACCOUNT_ID ?? "unset"}.r2.cloudflarestorage.com`;
  return new S3Client({
    region: "auto",
    endpoint,
    forcePathStyle: !!process.env.R2_ENDPOINT, // MinIO needs path-style
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY ?? "",
      secretAccessKey: process.env.R2_SECRET ?? "",
    },
  });
}

export function r2Bucket(): string {
  return process.env.R2_BUCKET ?? "agencyos";
}

// ===== Worker-side object I/O (media processing) =====
// The app never proxies file bytes (CLAUDE.md rule 5); these run only in the
// worker, which pulls a source object, processes it locally, and pushes results.

export async function r2GetToFile(key: string, destPath: string): Promise<void> {
  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const { createWriteStream } = await import("node:fs");
  const { pipeline } = await import("node:stream/promises");
  const res = await r2Client().send(new GetObjectCommand({ Bucket: r2Bucket(), Key: key }));
  const body = res.Body as NodeJS.ReadableStream;
  await pipeline(body, createWriteStream(destPath));
}

export async function r2PutFile(key: string, srcPath: string, contentType: string): Promise<void> {
  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  const { readFile } = await import("node:fs/promises");
  const body = await readFile(srcPath);
  await r2Client().send(
    new PutObjectCommand({ Bucket: r2Bucket(), Key: key, Body: body, ContentType: contentType }),
  );
}

/** Short-lived signed GET URL for private media (audit item 1: ≤15 min). */
export async function r2SignedGetUrl(key: string, ttlSeconds = 15 * 60): Promise<string> {
  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
  return getSignedUrl(r2Client(), new GetObjectCommand({ Bucket: r2Bucket(), Key: key }), {
    expiresIn: ttlSeconds,
  });
}
