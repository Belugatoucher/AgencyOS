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
