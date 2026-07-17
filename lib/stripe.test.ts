import { describe, expect, it } from "vitest";
import { signStripePayload, verifyStripeSignature } from "./stripe";

const SECRET = "whsec_test_secret";
const BODY = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });

describe("verifyStripeSignature", () => {
  it("accepts a correctly signed payload", () => {
    const header = signStripePayload(SECRET, BODY);
    expect(verifyStripeSignature(SECRET, BODY, header)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const header = signStripePayload(SECRET, BODY);
    expect(verifyStripeSignature(SECRET, BODY + "x", header)).toBe(false);
  });

  it("rejects the wrong secret", () => {
    const header = signStripePayload("whsec_other", BODY);
    expect(verifyStripeSignature(SECRET, BODY, header)).toBe(false);
  });

  it("rejects stale timestamps (replay window)", () => {
    const old = Math.floor(Date.now() / 1000) - 3600;
    const header = signStripePayload(SECRET, BODY, old);
    expect(verifyStripeSignature(SECRET, BODY, header)).toBe(false);
  });

  it("rejects missing/malformed headers", () => {
    expect(verifyStripeSignature(SECRET, BODY, null)).toBe(false);
    expect(verifyStripeSignature(SECRET, BODY, "t=abc,v1=")).toBe(false);
    expect(verifyStripeSignature(SECRET, BODY, "garbage")).toBe(false);
  });

  it("accepts when any v1 signature matches (key-roll case)", () => {
    const t = Math.floor(Date.now() / 1000);
    const good = signStripePayload(SECRET, BODY, t).split("v1=")[1];
    const header = `t=${t},v1=deadbeef,v1=${good}`;
    expect(verifyStripeSignature(SECRET, BODY, header)).toBe(true);
  });
});
