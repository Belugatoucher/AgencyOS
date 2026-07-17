import { describe, expect, it } from "vitest";
import { gradeQuiz, quizSchema, type Quiz } from "./academy";
import { headingSlug, sectionize } from "./sops";

describe("headingSlug", () => {
  it("slugifies like GitHub anchors", () => {
    expect(headingSlug("Client Kickoff: Step 1")).toBe("client-kickoff-step-1");
    expect(headingSlug("  Who's On The Call?  ")).toBe("whos-on-the-call");
  });
});

describe("sectionize", () => {
  it("splits a markdown body on headings with anchor slugs", () => {
    const body = [
      "Intro paragraph before any heading.",
      "# Client Kickoff",
      "Step one details.",
      "## Prep The Deck",
      "Deck details here.",
    ].join("\n");
    const sections = sectionize(body);
    expect(sections[0]).toMatchObject({ anchor: null });
    expect(sections[0]!.text).toContain("Intro paragraph");
    expect(sections[1]).toMatchObject({ anchor: "client-kickoff" });
    expect(sections[1]!.text).toContain("# Client Kickoff"); // heading kept for context
    expect(sections[2]).toMatchObject({ anchor: "prep-the-deck" });
  });

  it("re-chunks very long sections without losing the anchor", () => {
    const long = "word ".repeat(1000);
    const sections = sectionize(`# Big Section\n${long}`);
    expect(sections.length).toBeGreaterThan(1);
    expect(sections.every((s) => s.anchor === "big-section")).toBe(true);
  });
});

describe("gradeQuiz", () => {
  const quiz: Quiz = quizSchema.parse({
    pass_threshold: 0.8,
    questions: [
      { q: "Q1", kind: "multiple_choice", options: ["a", "b", "c", "d"], answer_index: 1, evidence_ms: 1000 },
      { q: "Q2", kind: "true_false", options: ["true", "false"], answer_index: 0, evidence_anchor: "naming" },
      { q: "Q3", kind: "multiple_choice", options: ["a", "b", "c", "d"], answer_index: 3 },
      { q: "Q4", kind: "true_false", options: ["true", "false"], answer_index: 1 },
      { q: "Q5", kind: "multiple_choice", options: ["a", "b", "c", "d"], answer_index: 0 },
    ],
  });

  it("passes at or above the threshold", () => {
    const r = gradeQuiz(quiz, [1, 0, 3, 1, 3]); // 4/5 = 0.8
    expect(r.score).toBeCloseTo(0.8);
    expect(r.passed).toBe(true);
    expect(r.wrong).toHaveLength(1);
  });

  it("fails below the threshold and returns rewatch evidence", () => {
    const r = gradeQuiz(quiz, [0, 1, 3, 1, 0]); // 3/5
    expect(r.passed).toBe(false);
    expect(r.wrong.map((w) => w.index)).toEqual([0, 1]);
    expect(r.wrong[0]!.evidenceMs).toBe(1000);
    expect(r.wrong[1]!.evidenceAnchor).toBe("naming");
  });

  it("perfect score passes", () => {
    expect(gradeQuiz(quiz, [1, 0, 3, 1, 0]).passed).toBe(true);
  });
});

describe("quizSchema", () => {
  it("rejects more than 7 questions", () => {
    const q = { q: "x", kind: "true_false", options: ["true", "false"], answer_index: 0 };
    expect(quizSchema.safeParse({ pass_threshold: 0.8, questions: Array(8).fill(q) }).success).toBe(false);
  });
});
