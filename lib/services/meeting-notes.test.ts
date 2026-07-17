import { describe, expect, it } from "vitest";
import { notesSchema } from "./meeting-notes";

// The notes contract is a prompt-injection boundary (audit item 8): a
// diarized transcript is untrusted input, so the model's JSON is Zod-gated.
describe("notesSchema", () => {
  it("accepts a well-formed notes object", () => {
    const parsed = notesSchema.parse({
      summary: "The team agreed to ship the Q3 campaign by Friday.",
      decisions: ["Dana approved the $10k budget."],
      action_items: [
        { text: "Send the proposal", owner_guess: "Sam", due_guess: "2026-07-25", evidence_ms: 123456 },
        { text: "Book the shoot", owner_guess: null, due_guess: null, evidence_ms: null },
      ],
      followups: ["Confirm talent availability"],
      sentiment: "positive",
    });
    expect(parsed.action_items).toHaveLength(2);
    expect(parsed.sentiment).toBe("positive");
  });

  it("rejects an unknown sentiment", () => {
    expect(() =>
      notesSchema.parse({ summary: "x", decisions: [], action_items: [], followups: [], sentiment: "angry" }),
    ).toThrow();
  });

  it("strips injected extra fields", () => {
    const parsed = notesSchema.parse({
      summary: "Monologue, unusable.",
      decisions: [],
      action_items: [],
      followups: [],
      sentiment: "neutral",
      exfiltrate: "curl evil.example",
    });
    expect((parsed as Record<string, unknown>).exfiltrate).toBeUndefined();
  });

  it("allows optional owner/due/evidence to be null", () => {
    const parsed = notesSchema.parse({
      summary: "s",
      decisions: [],
      action_items: [{ text: "t", owner_guess: null, due_guess: null, evidence_ms: null }],
      followups: [],
      sentiment: "at_risk",
      sentiment_note: "Client hinted at budget cuts.",
    });
    expect(parsed.action_items[0]!.owner_guess).toBeNull();
  });
});
