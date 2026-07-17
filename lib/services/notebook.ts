import { readFile } from "node:fs/promises";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { isInternal, type Viewer } from "@/lib/access";
import { anthropic } from "@/lib/ai/anthropic";
import { db } from "@/lib/db";
import { kbChunks, lessons, notebookGaps, sops, type NotebookGap } from "@/lib/db/schema";
import { embedText } from "@/lib/embeddings";
import { err, ok, type Result } from "@/lib/result";
import { postToSlack } from "@/lib/slack";

// Notebook (docs/16): ask-anything over INTERNAL knowledge only. Same
// read-only tool-use pattern as Ask the Brain, but the retrieval scope is
// kb_chunks and nothing else — the scope wall to client data is structural:
// no tool in this file can reach client tables, and Ask the Brain's tools
// never touch kb_chunks. Audit item 8 applies: read-only, Zod-gated inputs.

const NOTEBOOK_MODEL = process.env.BRAIN_CHAT_MODEL ?? "claude-sonnet-5";
const MAX_TOOL_ROUNDS = 6;
// Below this top-similarity the answer is "thin" and lands in notebook_gaps.
const THIN_SIMILARITY = 0.25;

let cachedPrompt: string | null = null;
async function systemPrompt(): Promise<string> {
  if (cachedPrompt) return cachedPrompt;
  const md = await readFile(path.join(process.cwd(), "prompts", "notebook.md"), "utf8");
  const match = md.match(/## System prompt\s*\n+```\n([\s\S]*?)\n```/);
  if (!match) throw new Error("Could not parse prompts/notebook.md");
  cachedPrompt = match[1]!.trim();
  return cachedPrompt;
}

export type KbHit = {
  citation: string; // sop:<id>#<anchor> | lesson:<id>@<start_ms>
  sourceTitle: string;
  text: string;
  similarity: number;
};

/** Semantic search over the kb scope. Also used directly by the UI search box. */
export async function searchHandbook(viewer: Viewer, query: string, limit = 6): Promise<Result<KbHit[]>> {
  if (!isInternal(viewer)) return err("forbidden", "The Notebook is internal");
  const qvec = await embedText(query);
  const vecLiteral = `[${qvec.join(",")}]`;
  const rows = await db
    .select({
      chunk: kbChunks,
      sopTitle: sops.title,
      lessonTitle: lessons.title,
      similarity: sql<number>`1 - (${kbChunks.embedding} <=> ${vecLiteral}::vector)`,
    })
    .from(kbChunks)
    .leftJoin(sops, and(eq(kbChunks.source, "sop"), eq(sops.id, kbChunks.sourceId)))
    .leftJoin(lessons, and(eq(kbChunks.source, "lesson"), eq(lessons.id, kbChunks.sourceId)))
    .where(sql`${kbChunks.embedding} is not null`)
    .orderBy(sql`${kbChunks.embedding} <=> ${vecLiteral}::vector`)
    .limit(limit);
  return ok(
    rows.map((r) => ({
      citation:
        r.chunk.source === "sop"
          ? `sop:${r.chunk.sourceId}${r.chunk.anchor ? `#${r.chunk.anchor}` : ""}`
          : `lesson:${r.chunk.sourceId}@${r.chunk.startMs ?? 0}`,
      sourceTitle: r.sopTitle ?? r.lessonTitle ?? "(unknown source)",
      text: r.chunk.chunkText,
      similarity: r.similarity,
    })),
  );
}

const searchInput = z.object({ query: z.string().max(500) });
const getSopInput = z.object({ sop_id: z.string().uuid() });

const toolDefs: Anthropic.Tool[] = [
  {
    name: "search_handbook",
    description:
      "Semantic search over the internal knowledge base: SOP sections and training lesson transcripts. Returns chunks with citations.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "get_sop",
    description: "Fetch one published SOP in full by id (from a search citation).",
    input_schema: { type: "object", properties: { sop_id: { type: "string" } }, required: ["sop_id"] },
  },
];

export type NotebookAnswer = {
  answer: string;
  citations: string[];
  confidence: "ok" | "thin" | "none";
};

export const askInput = z.object({ question: z.string().trim().min(1).max(2000) });

/** One Notebook Q&A turn: retrieval-grounded, cited, gap-tracked. */
export async function askNotebook(
  viewer: Viewer,
  question: string,
): Promise<Result<NotebookAnswer>> {
  if (!isInternal(viewer)) return err("forbidden", "The Notebook is internal");

  const citations: string[] = [];
  let topSimilarity = 0;
  let sawResults = false;

  const runTool = async (name: string, input: unknown): Promise<string> => {
    switch (name) {
      case "search_handbook": {
        const p = searchInput.parse(input);
        const r = await searchHandbook(viewer, p.query);
        if (!r.ok) return `Error: ${r.error.message}`;
        if (r.value.length) sawResults = true;
        topSimilarity = Math.max(topSimilarity, ...r.value.map((h) => h.similarity), 0);
        citations.push(...r.value.map((h) => h.citation));
        return JSON.stringify(r.value);
      }
      case "get_sop": {
        const p = getSopInput.parse(input);
        const [sop] = await db
          .select()
          .from(sops)
          .where(and(eq(sops.id, p.sop_id), sql`${sops.status} != 'draft'`));
        if (!sop) return "Error: SOP not found";
        citations.push(`sop:${sop.id}`);
        return JSON.stringify({ id: sop.id, title: sop.title, category: sop.category, body: sop.body });
      }
      default:
        return `Error: unknown tool ${name}`;
    }
  };

  const client = anthropic();
  const system = await systemPrompt();
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: question }];
  let answer = "";
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const msg = await client.messages.create({
      model: NOTEBOOK_MODEL,
      max_tokens: 2048,
      system,
      tools: toolDefs,
      messages,
    });
    messages.push({ role: "assistant", content: msg.content });
    const uses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (msg.stop_reason !== "tool_use" || uses.length === 0) {
      answer = msg.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      break;
    }
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of uses) {
      let content: string;
      try {
        content = await runTool(use.name, use.input);
      } catch (e) {
        content = `Error: invalid tool input (${e instanceof Error ? e.message : String(e)})`;
      }
      results.push({ type: "tool_result", tool_use_id: use.id, content });
    }
    messages.push({ role: "user", content: results });
  }
  if (!answer) return err("internal", "The Notebook did not produce an answer");

  const confidence: NotebookAnswer["confidence"] = !sawResults
    ? "none"
    : topSimilarity < THIN_SIMILARITY
      ? "thin"
      : "ok";
  // Weekly gap report input (docs/16): thin answers become the SOP backlog.
  if (confidence !== "ok") {
    await db.insert(notebookGaps).values({ question, askedBy: viewer.id, confidence });
  }
  return ok({ answer, citations: [...new Set(citations)], confidence });
}

// ---- Gap report (docs/16 weekly "SOPs we're missing") ----

export async function listGaps(viewer: Viewer): Promise<Result<NotebookGap[]>> {
  if (!isInternal(viewer)) return err("forbidden", "The Notebook is internal");
  return ok(
    await db
      .select()
      .from(notebookGaps)
      .where(isNull(notebookGaps.resolvedSopId))
      .orderBy(desc(notebookGaps.createdAt))
      .limit(100),
  );
}

export async function resolveGap(viewer: Viewer, gapId: string, sopId: string): Promise<Result<NotebookGap>> {
  if (!isInternal(viewer)) return err("forbidden", "The Notebook is internal");
  const [sop] = await db.select().from(sops).where(eq(sops.id, sopId));
  if (!sop) return err("not_found", "SOP not found");
  const [row] = await db
    .update(notebookGaps)
    .set({ resolvedSopId: sopId })
    .where(eq(notebookGaps.id, gapId))
    .returning();
  if (!row) return err("not_found", "Gap not found");
  return ok(row);
}

/** Cron: weekly Slack summary of unresolved gaps — the library grows toward what people ask. */
export async function notebookGapReport(): Promise<{ open: number }> {
  const open = await db
    .select({ question: notebookGaps.question })
    .from(notebookGaps)
    .where(isNull(notebookGaps.resolvedSopId))
    .orderBy(desc(notebookGaps.createdAt))
    .limit(10);
  if (open.length) {
    const lines = open.map((g) => `• ${g.question}`).join("\n");
    await postToSlack(`📚 SOPs we're missing (${open.length} open Notebook gaps this week):\n${lines}`);
  }
  return { open: open.length };
}
