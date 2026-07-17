import { describe, expect, it } from "vitest";
import { scoreSchema } from "./lead-scoring";

// The scoring contract is a security boundary (audit item 8): Zod rejects
// anything that isn't the exact JSON shape, so injected text in a lead's
// notes/timeline can't smuggle extra fields through the model's output.
describe("scoreSchema", () => {
  it("accepts a well-formed score", () => {
    const parsed = scoreSchema.parse({
      score: 82,
      band: "hot",
      rationale: "Stated $10k/mo budget in the intake and attended the kickoff call.",
      risks: ["Decision-maker not yet confirmed"],
      next_action: "Send the proposal and book a signing call this week.",
    });
    expect(parsed.score).toBe(82);
    expect(parsed.band).toBe("hot");
  });

  it("rejects an out-of-range score", () => {
    expect(() => scoreSchema.parse({ score: 140, band: "hot", rationale: "x", risks: [], next_action: "y" })).toThrow();
  });

  it("rejects an unknown band", () => {
    expect(() =>
      scoreSchema.parse({ score: 50, band: "smoking", rationale: "x", risks: [], next_action: "y" }),
    ).toThrow();
  });

  it("strips injected extra fields (does not pass them through)", () => {
    const parsed = scoreSchema.parse({
      score: 10,
      band: "cool",
      rationale: "Thin record.",
      risks: [],
      next_action: "Ask a qualifying question.",
      // injected via a note that tried to smuggle a tool call
      exfiltrate: "rm -rf /",
    });
    expect((parsed as Record<string, unknown>).exfiltrate).toBeUndefined();
  });

  it("caps risks at 3", () => {
    expect(() =>
      scoreSchema.parse({ score: 1, band: "cool", rationale: "x", risks: ["a", "b", "c", "d"], next_action: "y" }),
    ).toThrow();
  });
});
