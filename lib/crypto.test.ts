import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, secretHint } from "./crypto";

const key = randomBytes(32).toString("base64");

describe("encryptSecret / decryptSecret", () => {
  it("round-trips and never repeats ciphertext", () => {
    const a = encryptSecret("cf_api_token_123", key);
    const b = encryptSecret("cf_api_token_123", key);
    expect(a).not.toBe(b);
    expect(a.startsWith("v1:")).toBe(true);
    expect(a).not.toContain("cf_api_token_123");
    expect(decryptSecret(a, key)).toBe("cf_api_token_123");
  });

  it("accepts hex keys", () => {
    const hex = randomBytes(32).toString("hex");
    expect(decryptSecret(encryptSecret("x", hex), hex)).toBe("x");
  });

  it("rejects tampering and the wrong key", () => {
    const sealed = encryptSecret("secret", key);
    const parts = sealed.split(":");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join(":"), key)).toThrow();
    expect(() => decryptSecret(sealed, randomBytes(32).toString("base64"))).toThrow();
  });

  it("refuses missing or short keys", () => {
    expect(() => encryptSecret("x", undefined)).toThrow(/not set/);
    expect(() => encryptSecret("x", "c2hvcnQ=")).toThrow(/32 bytes/);
  });

  it("only ever hints the last four", () => {
    expect(secretHint("ghp_abcdefghijkl")).toBe("ijkl");
    expect(secretHint("short")).toBe("••••");
  });
});
