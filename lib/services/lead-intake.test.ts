import { describe, expect, it } from "vitest";
import { intakeSchema, parseCsv } from "./lead-intake";

describe("parseCsv", () => {
  it("parses a header row and records", () => {
    const rows = parseCsv("name,email,company\nAda Lovelace,ada@x.com,Analytical Engines\n");
    expect(rows).toEqual([
      { name: "Ada Lovelace", email: "ada@x.com", company: "Analytical Engines" },
    ]);
  });

  it("handles quoted fields with commas and escaped quotes", () => {
    const rows = parseCsv('name,note\n"Doe, Jane","She said ""hi"""\n');
    expect(rows[0]).toEqual({ name: "Doe, Jane", note: 'She said "hi"' });
  });

  it("skips blank lines and tolerates CRLF", () => {
    const rows = parseCsv("name\r\nA\r\n\r\nB\r\n");
    expect(rows.map((r) => r.name)).toEqual(["A", "B"]);
  });
});

describe("intakeSchema", () => {
  it("accepts a valid submission", () => {
    const r = intakeSchema.safeParse({ name: "Sam", email: "sam@co.com" });
    expect(r.success).toBe(true);
  });

  it("accepts a filled honeypot at the schema layer (dropped later, not a distinct error)", () => {
    // The honeypot must parse OK so a bot can't tell it tripped a validation
    // failure vs. a normal submission; ingestIntake drops it and returns 200.
    const r = intakeSchema.safeParse({ name: "Bot", website_url: "http://spam.example" });
    expect(r.success).toBe(true);
  });

  it("coerces an empty email string to undefined", () => {
    const r = intakeSchema.parse({ name: "Sam", email: "" });
    expect(r.email).toBeUndefined();
  });

  it("caps oversized fields", () => {
    const r = intakeSchema.safeParse({ name: "x".repeat(500) });
    expect(r.success).toBe(false);
  });
});
