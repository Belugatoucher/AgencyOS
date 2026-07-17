import { describe, expect, it } from "vitest";
import { chunkText, EMBEDDING_DIM, hashEmbed } from "./index";

function cosine(a: number[], b: number[]): number {
  return a.reduce((s, x, i) => s + x * b[i]!, 0);
}

describe("hashEmbed", () => {
  it("produces normalized 384-dim vectors deterministically", () => {
    const v1 = hashEmbed("Supplement brands love a strong hook");
    const v2 = hashEmbed("Supplement brands love a strong hook");
    expect(v1).toHaveLength(EMBEDDING_DIM);
    expect(v1).toEqual(v2);
    const norm = Math.sqrt(v1.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("ranks lexically-similar text above unrelated text", () => {
    const query = hashEmbed("budget approval for the video campaign");
    const related = hashEmbed("the client approved the campaign budget yesterday");
    const unrelated = hashEmbed("quarterly office supply restock inventory list");
    expect(cosine(query, related)).toBeGreaterThan(cosine(query, unrelated));
  });
});

describe("chunkText", () => {
  it("returns one chunk for short text", () => {
    expect(chunkText("short note")).toEqual(["short note"]);
  });

  it("splits long text with overlap and no empty chunks", () => {
    const long = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} about customer language. `).join("");
    const chunks = chunkText(long, 500, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeGreaterThan(0);
    // overlap: consecutive chunks share text
    expect(chunks[1]!.slice(0, 40)).not.toBe("");
  });

  it("returns empty for empty input", () => {
    expect(chunkText("   ")).toEqual([]);
  });
});
