import { describe, expect, it } from "vitest";
import { manualInstructions, signRunnerPayload, suggestedBranch, verifyRunnerSignature } from "./runners";

const secret = "runner-secret";

describe("remote runner signatures", () => {
  const body = JSON.stringify({ runRef: "r1", outcome: { ok: true } });
  const now = 1_800_000_000_000;
  const ts = String(now / 1000);
  const signature = signRunnerPayload(secret, ts, body);

  it("accepts a fresh, correct signature", () => {
    expect(verifyRunnerSignature(secret, { signature, timestamp: ts }, body, now)).toBe(true);
  });

  it("rejects tampered bodies, wrong secrets, stale or missing headers", () => {
    expect(verifyRunnerSignature(secret, { signature, timestamp: ts }, body + " ", now)).toBe(false);
    expect(verifyRunnerSignature("other", { signature, timestamp: ts }, body, now)).toBe(false);
    expect(verifyRunnerSignature(secret, { signature, timestamp: ts }, body, now + 6 * 60_000)).toBe(false);
    expect(verifyRunnerSignature(secret, { signature: null, timestamp: ts }, body, now)).toBe(false);
    expect(verifyRunnerSignature(secret, { signature: "zz", timestamp: ts }, body, now)).toBe(false);
  });
});

describe("manual runner", () => {
  it("names a branch per build and points at the skill pack entry", () => {
    expect(suggestedBranch({ kind: "initial", buildId: "1a2b3c4d-0000" })).toBe("sites/initial-1a2b3c4d");
    const text = manualInstructions({
      buildId: "1a2b3c4d-0000",
      kind: "initial",
      brief: "Lead with same-day service",
      designSystem: null,
      snapshot: null,
      evidence: {},
      site: { id: "s", slug: "granite", name: "Granite", domain: null, repoRef: "vngrd/granite", hostRef: null },
      skillPack: { id: "vngrd-default", version: "0.1.0", phase: "build", root: "skills/sites/vngrd-default", entry: "build.md" },
    });
    expect(text.includes("sites/initial-1a2b3c4d")).toBe(true);
    expect(text.includes("skills/sites/vngrd-default/build.md")).toBe(true);
    expect(text.includes("Lead with same-day service")).toBe(true);
  });
});
