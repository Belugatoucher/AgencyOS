import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// App-level encryption for stored provider tokens (audit item 2):
// AES-256-GCM with APP_ENCRYPTION_KEY (32 bytes, base64 or hex).
// Format: "v1:<iv>:<tag>:<ciphertext>", each part base64url.
// Pure module (no app imports) so it is unit-testable without the DB.

const VERSION = "v1";

function keyFrom(raw: string | undefined): Buffer {
  if (!raw) throw new Error("APP_ENCRYPTION_KEY is not set");
  const trimmed = raw.trim();
  const buf = /^[0-9a-f]{64}$/i.test(trimmed) ? Buffer.from(trimmed, "hex") : Buffer.from(trimmed, "base64");
  if (buf.length !== 32) throw new Error("APP_ENCRYPTION_KEY must decode to 32 bytes");
  return buf;
}

export function encryptSecret(plaintext: string, rawKey = process.env.APP_ENCRYPTION_KEY): string {
  const key = keyFrom(rawKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(":");
}

export function decryptSecret(sealed: string, rawKey = process.env.APP_ENCRYPTION_KEY): string {
  const [version, iv, tag, ct] = sealed.split(":");
  if (version !== VERSION || !iv || !tag || ct === undefined) throw new Error("Unrecognised secret format");
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(rawKey), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

/** Last four characters for display; never more. */
export function secretHint(plaintext: string): string {
  return plaintext.length <= 8 ? "••••" : plaintext.slice(-4);
}
