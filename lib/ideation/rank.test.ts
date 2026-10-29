import { describe, expect, it } from "vitest";
import { cleanDueDate, cleanGoalId, fillTemplate, groupItems, priorityScore, rankItems, segmentsToText, todayIn, type RankableItem } from "./rank";

const item = (o: Partial<RankableItem> & { id?: string } = {}) => ({
  kind: "action" as const,
  alignment: "advances" as const,
  impact: 3,
  effort: 3,
  horizon: "this_month" as const,
  ...o,
});

describe("priorityScore / rankItems", () => {
  it("favors aligned, high-impact, low-effort, urgent work", () => {
    const quickWin = item({ impact: 5, effort: 1, horizon: "now" });
    const slog = item({ impact: 5, effort: 5 });
    const offStrategy = item({ impact: 5, effort: 1, horizon: "now", alignment: "off_strategy" });
    expect(priorityScore(quickWin)).toBeGreaterThan(priorityScore(slog));
    expect(priorityScore(quickWin)).toBeGreaterThan(priorityScore(offStrategy));
    expect(rankItems([slog, offStrategy, quickWin])[0]).toBe(quickWin);
  });

  it("treats missing or out-of-range scores as middling instead of crashing", () => {
    expect(priorityScore(item({ impact: null, effort: 99 }))).toBe(priorityScore(item({ impact: 3, effort: 5 })));
  });

  it("keeps the model's order for ties", () => {
    const a = item({ id: "a" } as never);
    const b = item({ id: "b" } as never);
    expect(rankItems([a, b])).toEqual([a, b]);
  });
});

describe("groupItems", () => {
  it("routes by kind, and sends anything off-strategy to flags", () => {
    const g = groupItems([
      item({ kind: "action" }),
      item({ kind: "action", alignment: "off_strategy" }),
      item({ kind: "goal", alignment: "new_direction" }),
      item({ kind: "idea", horizon: "later" }),
      item({ kind: "question" }),
      item({ kind: "risk" }),
    ]);
    expect([g.doNext.length, g.goals.length, g.park.length, g.questions.length, g.flags.length]).toEqual([1, 1, 1, 1, 2]);
  });
});

describe("cleanup", () => {
  it("keeps only real, future-ish due dates", () => {
    expect(cleanDueDate("2026-10-31", "2026-10-29")).toBe("2026-10-31");
    expect(cleanDueDate("2026-10-29", "2026-10-29")).toBe("2026-10-29");
    expect(cleanDueDate("2026-10-01", "2026-10-29")).toBe(null);
    expect(cleanDueDate("2026-02-30", "2026-01-01")).toBe(null);
    expect(cleanDueDate("Friday", "2026-10-29")).toBe(null);
    expect(cleanDueDate("2031-01-01", "2026-10-29")).toBe(null);
  });

  it("drops goal ids the model invented", () => {
    expect(cleanGoalId("g1", ["g1", "g2"])).toBe("g1");
    expect(cleanGoalId("made-up", ["g1"])).toBe(null);
    expect(cleanGoalId(null, ["g1"])).toBe(null);
  });

  it("resolves today in the business's time zone", () => {
    const lateNightUtc = new Date("2026-10-30T03:30:00Z"); // still Oct 29 in Chicago
    expect(todayIn("America/Chicago", lateNightUtc)).toEqual({ iso: "2026-10-29", weekday: "Thursday" });
  });

  it("fills templates and flattens transcripts", () => {
    expect(fillTemplate("Hi {{name}} {{missing}}!", { name: "Ryan" })).toBe("Hi Ryan !");
    expect(segmentsToText([{ text: " so um " }, { text: "" }, { text: "we should  call Mike" }])).toBe("so um we should call Mike");
    expect(segmentsToText([{ text: "abcdef" }], 3)).toBe("abc …[cut]");
  });
});
