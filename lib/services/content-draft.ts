import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { anthropic, LEAD_SCORING_MODEL, messageText } from "@/lib/ai/anthropic";
import { CHANNELS } from "@/lib/scheduler/channels";

// content-repurpose uses temp 0.7 in the prompt frontmatter; on the current
// Sonnet, temperature is rejected, so it's omitted (same DECISION as scoring/
// notes). Variance comes from hook_alternatives in the schema. Override model
// with CONTENT_DRAFT_MODEL.
const DRAFT_MODEL = process.env.CONTENT_DRAFT_MODEL ?? LEAD_SCORING_MODEL;

export const draftSchema = z.object({
  variants: z
    .array(
      z.object({
        channel: z.enum(CHANNELS),
        body: z.string().max(10_000),
        hook_alternatives: z.array(z.string().max(500)).max(5).default([]),
        media_direction: z.string().max(1000).optional(),
        hashtags: z.array(z.string().max(60)).max(8).default([]),
      }),
    )
    .max(5),
  angle_note: z.string().max(1000),
});
export type Draft = z.infer<typeof draftSchema>;

export const draftRequest = z.object({
  channels: z.array(z.enum(CHANNELS)).min(1).max(5),
  source: z.string().min(1).max(20_000),
});

let cachedSystem: string | null = null;
async function systemPrompt(): Promise<string> {
  if (cachedSystem) return cachedSystem;
  const md = await readFile(path.join(process.cwd(), "prompts", "content-repurpose.md"), "utf8");
  const m = md.match(/## System prompt\s*\n+```\n([\s\S]*?)\n```/);
  if (!m) throw new Error("Could not parse system prompt from prompts/content-repurpose.md");
  cachedSystem = m[1]!.trim();
  return cachedSystem;
}

/** Draft platform-native variants from a source. Zod-gated with one retry. */
export async function draftContent(
  account: { name: string; brand: Record<string, unknown> },
  channels: string[],
  source: string,
): Promise<Draft> {
  const brand = account.brand as { voice?: string; audience?: string };
  const user = [
    `Client: ${account.name}`,
    `Voice profile: ${brand.voice ?? "none provided"}`,
    `Audience: ${brand.audience ?? "unknown"}`,
    `Channels requested: ${JSON.stringify(channels)}`,
    `Source material:`,
    source,
  ].join("\n");

  const system = await systemPrompt();
  const client = anthropic();
  async function attempt(extra?: string): Promise<Draft> {
    const msg = await client.messages.create({
      model: DRAFT_MODEL,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: extra ? `${user}\n\n${extra}` : user }],
    });
    const text = messageText(msg).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    return draftSchema.parse(JSON.parse(text));
  }
  try {
    return await attempt();
  } catch {
    return await attempt("Return only the JSON object.");
  }
}
