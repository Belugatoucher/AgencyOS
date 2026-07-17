import { describe, expect, it } from "vitest";
import { nextOccurrence, parseRRule } from "./rrule";

describe("parseRRule", () => {
  it("parses a weekly BYDAY rule", () => {
    expect(parseRRule("FREQ=WEEKLY;BYDAY=TU,TH,SA")).toEqual({
      freq: "WEEKLY",
      interval: 1,
      byDay: [2, 4, 6],
    });
  });

  it("strips an RRULE: prefix and reads INTERVAL", () => {
    expect(parseRRule("RRULE:FREQ=DAILY;INTERVAL=3")).toEqual({ freq: "DAILY", interval: 3 });
  });

  it("rejects unsupported or missing FREQ", () => {
    expect(parseRRule("FREQ=YEARLY")).toBeNull();
    expect(parseRRule("BYDAY=MO")).toBeNull();
  });
});

describe("nextOccurrence", () => {
  it("daily advances by interval days at the same time", () => {
    const after = new Date("2026-07-17T09:00:00Z"); // Friday
    expect(nextOccurrence("FREQ=DAILY", after)?.toISOString()).toBe("2026-07-18T09:00:00.000Z");
    expect(nextOccurrence("FREQ=DAILY;INTERVAL=3", after)?.toISOString()).toBe(
      "2026-07-20T09:00:00.000Z",
    );
  });

  it("weekly BYDAY lands on the next listed weekday", () => {
    // 2026-07-17 is a Friday; next TU/TH/SA is Saturday the 18th
    const after = new Date("2026-07-17T09:00:00Z");
    expect(nextOccurrence("FREQ=WEEKLY;BYDAY=TU,TH,SA", after)?.toISOString()).toBe(
      "2026-07-18T09:00:00.000Z",
    );
  });

  it("weekly BYDAY wraps to the following week", () => {
    // Saturday → next is Tuesday
    const after = new Date("2026-07-18T09:00:00Z");
    expect(nextOccurrence("FREQ=WEEKLY;BYDAY=TU,TH,SA", after)?.toISOString()).toBe(
      "2026-07-21T09:00:00.000Z",
    );
  });

  it("monthly BYMONTHDAY=1 fires on the 1st of next month", () => {
    const after = new Date("2026-07-17T08:00:00Z");
    expect(nextOccurrence("FREQ=MONTHLY;BYMONTHDAY=1", after)?.toISOString()).toBe(
      "2026-08-01T08:00:00.000Z",
    );
  });

  it("monthly returns the same-month day when it is still ahead", () => {
    const after = new Date("2026-07-01T08:00:00Z");
    expect(nextOccurrence("FREQ=MONTHLY;BYMONTHDAY=15", after)?.toISOString()).toBe(
      "2026-07-15T08:00:00.000Z",
    );
  });

  it("returns null for an invalid rule", () => {
    expect(nextOccurrence("nonsense", new Date())).toBeNull();
  });
});
