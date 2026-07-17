import { readFile } from "node:fs/promises";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { canViewAccount, isInternal, type Viewer } from "@/lib/access";
import { anthropic } from "@/lib/ai/anthropic";
import { db } from "@/lib/db";
import { accounts, aiThreads, type AiThread } from "@/lib/db/schema";
import { err, ok, type Result } from "@/lib/result";
import { getBrain } from "@/lib/services/brain";
import { listCreatives } from "@/lib/services/creatives";
import { HOOK_FORMATS, searchHooks } from "@/lib/services/hooks";
import { RESEARCH_KINDS, searchResearch } from "@/lib/services/research";

// Ask the Brain (docs/08). Audit item 8 controls, all enforced here:
// - every tool is READ-ONLY (retrieval + get_brain; no writes reachable)
// - tool inputs from the model are Zod-gated before touching a service
// - retrieval runs through the normal services with the human viewer, so
//   account scoping applies; scope is structurally this-account + the global
//   library — other clients' rows are never fetched, so nothing to anonymize
// - every thread stores the retrieval IDs used (audit trail in ai_threads)

// DECISION: prompts/client-brain.md names claude-sonnet-4-6 + temp 0.7/0;
// same call as lead scoring — configurable model, default current Sonnet,
// sampling params omitted (current Sonnet rejects non-default temperature).
// Prompt text is used verbatim (CLAUDE.md rule 6).
const BRAIN_CHAT_MODEL = process.env.BRAIN_CHAT_MODEL ?? "claude-sonnet-5";
const MAX_TOOL_ROUNDS = 8;

let cachedPrompt: string | null = null;
async function systemPrompt(accountName: string): Promise<string> {
  if (!cachedPrompt) {
    const md = await readFile(path.join(process.cwd(), "prompts", "client-brain.md"), "utf8");
    const match = md.match(/## System prompt\s*\n+```\n([\s\S]*?)\n```/);
    if (!match) throw new Error("Could not parse system prompt from prompts/client-brain.md");
    cachedPrompt = match[1]!.trim();
  }
  return cachedPrompt.replaceAll("{{account_name}}", accountName);
}

// ---- Tools (read-only; names/shapes from prompts/client-brain.md) ----

const searchHooksInput = z.object({
  query: z.string().max(500),
  format: z.enum(HOOK_FORMATS).optional(),
  platform: z.string().max(50).optional(),
});
const searchResearchInput = z.object({
  query: z.string().max(500),
  kind: z.enum(RESEARCH_KINDS).optional(),
});
const searchCreativesInput = z.object({
  platform: z.string().max(50).optional(),
  winning_only: z.boolean().optional(),
});

const toolDefs: Anthropic.Tool[] = [
  {
    name: "search_hooks",
    description:
      "Search the hooks library (this client's hooks + the global library) by meaning. Returns top hooks with format, platform, and metrics.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        format: { type: "string", enum: [...HOOK_FORMATS] },
        platform: { type: "string" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_research",
    description:
      "Semantic search over research documents (this client's + general market research). kind=voc returns real customer language. Returns top chunks with doc titles.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        kind: { type: "string", enum: [...RESEARCH_KINDS] },
      },
      required: ["query"],
    },
  },
  {
    name: "search_creatives",
    description:
      "List this client's logged creatives with metrics, spend, and written learnings. Set winning_only for top performers.",
    input_schema: {
      type: "object",
      properties: {
        platform: { type: "string" },
        winning_only: { type: "boolean" },
      },
    },
  },
  {
    name: "get_brain",
    description:
      "Get the full structured Client Brain: offer, ICP, positioning, voice do/don't, objections, proof points, compliance rules, goals, learnings.",
    input_schema: { type: "object", properties: {} },
  },
];

async function runTool(
  viewer: Viewer,
  accountId: string,
  name: string,
  input: unknown,
  retrievalIds: string[],
): Promise<string> {
  switch (name) {
    case "search_hooks": {
      const p = searchHooksInput.parse(input);
      const r = await searchHooks(viewer, {
        q: p.query,
        format: p.format,
        platform: p.platform,
        account: accountId,
      });
      if (!r.ok) return `Error: ${r.error.message}`;
      const hits = r.value.slice(0, 8).map((h) => ({
        id: h.id,
        text: h.text,
        format: h.format,
        platform: h.platform,
        niche_tags: h.nicheTags,
        metrics: h.metrics,
        scope: h.accountId ? "account" : "global",
      }));
      retrievalIds.push(...hits.map((h) => `hook:${h.id}`));
      return JSON.stringify(hits);
    }
    case "search_research": {
      const p = searchResearchInput.parse(input);
      const r = await searchResearch(viewer, p.query, { accountId, kind: p.kind });
      if (!r.ok) return `Error: ${r.error.message}`;
      retrievalIds.push(...r.value.map((c) => `chunk:${c.chunkId}`));
      return JSON.stringify(
        r.value.map((c) => ({
          doc_title: c.docTitle,
          kind: c.kind,
          text: c.chunkText,
          similarity: Number(c.similarity?.toFixed(3)),
        })),
      );
    }
    case "search_creatives": {
      const p = searchCreativesInput.parse(input);
      const r = await listCreatives(viewer, accountId, {
        platform: p.platform,
        winningOnly: p.winning_only,
      });
      if (!r.ok) return `Error: ${r.error.message}`;
      const rows = r.value.slice(0, 12).map((c) => ({
        id: c.id,
        platform: c.platform,
        metrics: c.metrics,
        spend_cents: c.spendCents,
        is_winning: c.isWinning,
        learning: c.learning,
      }));
      retrievalIds.push(...rows.map((c) => `creative:${c.id}`));
      return JSON.stringify(rows);
    }
    case "get_brain": {
      const r = await getBrain(viewer, accountId);
      if (!r.ok) return `Error: ${r.error.message}`;
      const b = r.value;
      return JSON.stringify({
        offer: b.offer,
        icp: b.icp,
        positioning: b.positioning,
        voice: b.voice,
        objections: b.objections,
        proof_points: b.proofPoints,
        compliance_nos: b.complianceNos,
        goals_current_quarter: b.goalsCurrentQuarter,
        learnings: b.learnings,
        version: b.version,
      });
    }
    default:
      return `Error: unknown tool ${name}`;
  }
}

export type BrainReply = {
  threadId: string;
  reply: string;
  citations: string[];
};

export const chatInput = z.object({
  message: z.string().trim().min(1).max(8000),
  threadId: z.string().uuid().nullish(),
});

/**
 * One chat turn against the Brain: tool-use loop with read-only retrieval,
 * persisted to ai_threads (messages + retrieval-ID audit trail). Interactive,
 * so it runs inline rather than as a job.
 */
export async function askBrain(
  viewer: Viewer,
  accountId: string,
  input: z.infer<typeof chatInput>,
): Promise<Result<BrainReply>> {
  if (!isInternal(viewer)) return err("forbidden", "The Brain is internal");
  if (!canViewAccount(viewer, accountId)) return err("not_found", "Account not found");

  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  if (!account) return err("not_found", "Account not found");

  let thread: AiThread | null = null;
  if (input.threadId) {
    const [existing] = await db.select().from(aiThreads).where(eq(aiThreads.id, input.threadId));
    if (!existing || existing.accountId !== accountId) return err("not_found", "Thread not found");
    thread = existing;
  }

  const history = (thread?.messages ?? []) as Anthropic.MessageParam[];
  const messages: Anthropic.MessageParam[] = [...history, { role: "user", content: input.message }];
  const retrievalIds: string[] = [];
  const system = await systemPrompt(account.name);
  const client = anthropic();

  let reply = "";
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const msg = await client.messages.create({
      model: BRAIN_CHAT_MODEL,
      max_tokens: 4096,
      system,
      tools: toolDefs,
      messages,
    });
    messages.push({ role: "assistant", content: msg.content });

    const toolUses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (msg.stop_reason !== "tool_use" || toolUses.length === 0) {
      reply = msg.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      break;
    }
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      let content: string;
      try {
        content = await runTool(viewer, accountId, use.name, use.input, retrievalIds);
      } catch (e) {
        // Zod-gated inputs: a malformed tool call becomes an error the model
        // can correct, never an unvalidated service call.
        content = `Error: invalid tool input (${e instanceof Error ? e.message : String(e)})`;
      }
      results.push({ type: "tool_result", tool_use_id: use.id, content });
    }
    messages.push({ role: "user", content: results });
  }
  if (!reply) return err("internal", "The Brain did not produce a reply");

  const allRetrievalIds = [...((thread?.retrievalIds as string[]) ?? []), ...retrievalIds];
  if (thread) {
    await db
      .update(aiThreads)
      .set({ messages, retrievalIds: allRetrievalIds, updatedAt: new Date() })
      .where(eq(aiThreads.id, thread.id));
  } else {
    const [created] = await db
      .insert(aiThreads)
      .values({
        accountId,
        userId: viewer.id,
        title: input.message.slice(0, 80),
        messages,
        retrievalIds,
      })
      .returning();
    thread = created!;
  }
  return ok({ threadId: thread.id, reply, citations: retrievalIds });
}

export async function listThreads(viewer: Viewer, accountId: string): Promise<Result<AiThread[]>> {
  if (!isInternal(viewer)) return err("forbidden", "The Brain is internal");
  if (!canViewAccount(viewer, accountId)) return err("not_found", "Account not found");
  return ok(
    await db
      .select()
      .from(aiThreads)
      .where(eq(aiThreads.accountId, accountId))
      .orderBy(desc(aiThreads.updatedAt))
      .limit(50),
  );
}

/**
 * Content brief (docs/08 output shape 7): same loop, brief-shaped request.
 * The system prompt's rule 7 defines the brief structure; we just frame the ask.
 */
export const briefInput = z.object({
  topic: z.string().trim().min(1).max(2000),
  platform: z.string().max(50).default("short-form video"),
});

export async function generateBrief(
  viewer: Viewer,
  accountId: string,
  input: z.infer<typeof briefInput>,
): Promise<Result<BrainReply>> {
  return askBrain(viewer, accountId, {
    message: `Create a content brief for ${input.platform}: ${input.topic}`,
    threadId: null,
  });
}
