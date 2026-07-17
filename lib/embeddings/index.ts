import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export const EMBEDDING_DIM = 384; // matches vector(384) in db/002-intelligence.sql

// DECISION: embeddings are pluggable via EMBED_MODE.
//  - "local"  → scripts/embed.py (sentence-transformers bge-small-en-v1.5, 384-dim)
//               runs on the worker box so client data never leaves our infra
//               (docs/08). Dockerfile.worker installs the deps.
//  - "hash"   → deterministic token-hash bag-of-words vectors (default in dev/CI
//               where the model isn't installed). Not semantic, but cosine
//               similarity equals lexical overlap, so retrieval ordering is
//               real enough to test the whole rail end to end.
const EMBED_MODE = process.env.EMBED_MODE ?? "hash";
const EMBED_CMD = process.env.EMBED_CMD ?? "python3";
const EMBED_SCRIPT = process.env.EMBED_SCRIPT ?? path.join(process.cwd(), "scripts", "embed.py");

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

/** FNV-1a hash → bucket index. Deterministic across runs/processes. */
function bucket(token: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % EMBEDDING_DIM;
}

export function hashEmbed(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIM).fill(0);
  for (const token of tokenize(text)) v[bucket(token)]! += 1;
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

async function localEmbed(texts: string[]): Promise<number[][]> {
  const dir = await mkdtemp(path.join(tmpdir(), "agencyos-embed-"));
  try {
    const inFile = path.join(dir, "in.json");
    const outFile = path.join(dir, "out.json");
    await writeFile(inFile, JSON.stringify({ texts }));
    await run(EMBED_CMD, [EMBED_SCRIPT, "--input", inFile, "--output", outFile], {
      timeout: 5 * 60 * 1000,
      maxBuffer: 64 * 1024 * 1024,
    });
    const parsed = JSON.parse(await readFile(outFile, "utf8")) as { embeddings: number[][] };
    return parsed.embeddings;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Embed a batch of texts to 384-dim vectors via the configured mode. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (EMBED_MODE === "local") return localEmbed(texts);
  return texts.map(hashEmbed);
}

export async function embedText(text: string): Promise<number[]> {
  const [v] = await embedTexts([text]);
  return v!;
}

/** Split long text into overlapping chunks for embedding (docs/08 research). */
export function chunkText(text: string, maxChars = 1200, overlap = 150): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (clean.length <= maxChars) return clean ? [clean] : [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + maxChars, clean.length);
    if (end < clean.length) {
      // prefer to break at a paragraph or sentence boundary
      const para = clean.lastIndexOf("\n\n", end);
      const sentence = clean.lastIndexOf(". ", end);
      const brk = Math.max(para, sentence);
      if (brk > start + maxChars / 2) end = brk + 1;
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = end - overlap;
  }
  return chunks.filter((c) => c.length > 0);
}
