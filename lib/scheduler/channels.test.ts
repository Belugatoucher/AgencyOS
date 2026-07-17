import { describe, expect, it } from "vitest";
import { validatePost } from "./channels";

describe("validatePost", () => {
  it("passes a valid multi-channel post", () => {
    const issues = validatePost({
      channels: ["facebook", "linkedin"],
      body: "A concise, on-brand update about our launch.",
      channelOverrides: {},
      mediaCount: 0,
    });
    expect(issues).toHaveLength(0);
  });

  it("flags instagram/tiktok media requirement", () => {
    const issues = validatePost({ channels: ["instagram"], body: "caption", channelOverrides: {}, mediaCount: 0 });
    expect(issues.some((i) => i.channel === "instagram" && /requires at least one media/.test(i.message))).toBe(true);
  });

  it("flags an over-limit tiktok caption", () => {
    const issues = validatePost({
      channels: ["tiktok"],
      body: "x".repeat(200),
      channelOverrides: {},
      mediaCount: 1,
    });
    expect(issues.some((i) => i.channel === "tiktok" && /exceeds 150/.test(i.message))).toBe(true);
  });

  it("uses the per-channel override body when present", () => {
    const issues = validatePost({
      channels: ["linkedin"],
      body: "x".repeat(5000), // default too long...
      channelOverrides: { linkedin: { body: "short override" } }, // ...but override is fine
      mediaCount: 0,
    });
    expect(issues).toHaveLength(0);
  });

  it("flags an empty post with no media", () => {
    const issues = validatePost({ channels: ["facebook"], body: "", channelOverrides: {}, mediaCount: 0 });
    expect(issues.some((i) => /body text or media/.test(i.message))).toBe(true);
  });

  it("rejects an unknown channel", () => {
    const issues = validatePost({ channels: ["myspace"], body: "hi", channelOverrides: {}, mediaCount: 1 });
    expect(issues.some((i) => /Unknown channel/.test(i.message))).toBe(true);
  });
});
