import { randomUUID } from "node:crypto";
import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  PutObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { canMutateAccount, canViewAccount, type Viewer } from "@/lib/access";
import { db } from "@/lib/db";
import { files, type FileRecord } from "@/lib/db/schema";
import { err, ok, type Result } from "@/lib/result";
import { r2Bucket, r2Client } from "@/lib/r2";

// Browser ↔ R2 direct via presigned URLs; the app never proxies bytes
// (CLAUDE.md rule 5). Multipart above 100MB per HANDOFF item 7.

const MULTIPART_THRESHOLD = 100 * 1024 * 1024;
const PART_SIZE = 50 * 1024 * 1024;
const MAX_SIZE = 2 * 1024 * 1024 * 1024; // 2GB cap until Review needs more
const PRESIGN_TTL = 15 * 60; // presigned URLs are short-lived (audit item 1)

export const presignInput = z.object({
  accountId: z.string().uuid(),
  filename: z.string().trim().min(1).max(255),
  mime: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive().max(MAX_SIZE),
});

export const completeInput = z.object({
  accountId: z.string().uuid(),
  key: z.string().min(1).max(1024),
  filename: z.string().trim().min(1).max(255),
  mime: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive().max(MAX_SIZE),
  checksum: z.string().max(128).optional(),
  // multipart finish
  uploadId: z.string().max(1024).optional(),
  parts: z
    .array(z.object({ partNumber: z.number().int().positive(), etag: z.string().max(256) }))
    .max(1000)
    .optional(),
});

export type PresignResult =
  | { mode: "single"; key: string; url: string }
  | {
      mode: "multipart";
      key: string;
      uploadId: string;
      partSize: number;
      urls: { partNumber: number; url: string }[];
    };

function safeFilename(name: string): string {
  // strip any path segments and control chars; keep it recognizable
  const base = name.split(/[\\/]/).pop() ?? "file";
  return base.replace(/[^\w.\-() ]+/g, "_").slice(0, 200) || "file";
}

export function objectKey(accountId: string, filename: string): string {
  // {account_id}/{module}/{uuid}/{filename} per docs/00 — module is "uploads"
  // until module-specific services (assets, review, notes) register their own.
  return `${accountId}/uploads/${randomUUID()}/${safeFilename(filename)}`;
}

export async function presignUpload(
  viewer: Viewer,
  input: z.infer<typeof presignInput>,
): Promise<Result<PresignResult>> {
  if (!canViewAccount(viewer, input.accountId)) return err("not_found", "Account not found");
  if (!canMutateAccount(viewer, input.accountId)) {
    return err("forbidden", "Only the team can upload files");
  }

  const client = r2Client();
  const bucket = r2Bucket();
  const key = objectKey(input.accountId, input.filename);

  if (input.sizeBytes <= MULTIPART_THRESHOLD) {
    const url = await getSignedUrl(
      client,
      new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: input.mime }),
      { expiresIn: PRESIGN_TTL },
    );
    return ok({ mode: "single", key, url });
  }

  const created = await client.send(
    new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: input.mime }),
  );
  const uploadId = created.UploadId!;
  const partCount = Math.ceil(input.sizeBytes / PART_SIZE);
  const urls = await Promise.all(
    Array.from({ length: partCount }, (_, i) => i + 1).map(async (partNumber) => ({
      partNumber,
      url: await getSignedUrl(
        client,
        new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }),
        { expiresIn: PRESIGN_TTL },
      ),
    })),
  );
  return ok({ mode: "multipart", key, uploadId, partSize: PART_SIZE, urls });
}

export async function completeUpload(
  viewer: Viewer,
  input: z.infer<typeof completeInput>,
): Promise<Result<FileRecord>> {
  if (!canViewAccount(viewer, input.accountId)) return err("not_found", "Account not found");
  if (!canMutateAccount(viewer, input.accountId)) {
    return err("forbidden", "Only the team can upload files");
  }
  // keys are minted by presignUpload; refuse registration outside the account's namespace
  if (!input.key.startsWith(`${input.accountId}/`)) {
    return err("invalid", "File key does not belong to this account");
  }

  if (input.uploadId && input.parts?.length) {
    await r2Client().send(
      new CompleteMultipartUploadCommand({
        Bucket: r2Bucket(),
        Key: input.key,
        UploadId: input.uploadId,
        MultipartUpload: {
          Parts: input.parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
        },
      }),
    );
  }

  const [row] = await db
    .insert(files)
    .values({
      accountId: input.accountId,
      r2Key: input.key,
      filename: safeFilename(input.filename),
      mime: input.mime,
      sizeBytes: input.sizeBytes,
      checksum: input.checksum,
      uploadedBy: viewer.id,
    })
    .returning();
  return ok(row!);
}

export async function listFiles(viewer: Viewer, accountId: string): Promise<Result<FileRecord[]>> {
  if (!canViewAccount(viewer, accountId)) return err("not_found", "Account not found");
  const rows = await db
    .select()
    .from(files)
    .where(eq(files.accountId, accountId))
    .orderBy(desc(files.createdAt));
  return ok(rows);
}
