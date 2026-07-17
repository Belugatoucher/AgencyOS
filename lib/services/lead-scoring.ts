import { readFile } from "node:fs/promises";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { leadActivities, leads, type Lead } from "@/lib/db/schema";
import { anthropic, LEAD_SCORING_MODEL, messageText } from "@/lib/ai/anthropic";

// The scoring model's JSON contract (prompts/lead-scoring.md). Zod-validated so
// injected text in notes/timeline can't smuggle extra fields (audit item 8).
export const scoreSchema = z.object({
  score: z.number().int().min(0).max(100),
  band: z.enum(["hot", "warm", "cool", "disqualify"]),
  rationale: z.string().min(1).max(2000),
  risks: z.array(z.string().max(500)).max(3),
  next_action: z.string().min(1).max(1000),
});
export type LeadScore = z.infer<typeof scoreSchema>;

// System prompt is loaded from prompts/lead-scoring.md verbatim (CLAUDE.md
// rule 6) — the fenced block between the "## System prompt" heading and its close.
let cachedSystemPrompt: string | null = null;
async function systemPrompt(): Promise<string> {
  if (cachedSystemPrompt) return cachedSystemPrompt;
  const md = await readFile(path.join(process.cwd(), "prompts", "lead-scoring.md"), "utf8");
  const match = md.match(/## System prompt\s*\n+```\n([\s\S]*?)\n```/);
  if (!match) throw new Error("Could not parse system prompt from prompts/lead-scoring.md");
  cachedSystemPrompt = match[1]!.trim();
  return cachedSystemPrompt;
}

function buildUserMessage(
  lead: Lead,
  activities: { kind: string; body: unknown; createdAt: Date }[],
): string {
  const servicesBlurb =
    process.env.AGENCY_SERVICES_BLURB ??
    "A full-service marketing agency: paid social, content, video production, and web.";
  // Mirrors the docs/02 user-message template.
  return [
    `Agency services: ${servicesBlurb}`,
    `Lead: ${JSON.stringify({
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      company: lead.company,
      value_cents: lead.valueCents,
      source: lead.source,
      tags: lead.tags,
      status: lead.status,
      created_at: lead.createdAt,
      next_action_at: lead.nextActionAt,
      internal_notes: lead.internalNotes,
    })}`,
    `Timeline (newest first, max 30): ${JSON.stringify(activities.slice(0, 30))}`,
    `Linked meeting summaries: none`,
    `Today: ${new Date().toISOString().slice(0, 10)}`,
  ].join("\n");
}

/**
 * Score a lead via Claude. Parses JSON with one retry, then fails loudly
 * (CLAUDE.md rule 6). Called from the `ai` queue worker, not inline.
 */
export async function scoreLead(leadId: string): Promise<LeadScore> {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
  if (!lead) throw new Error(`Lead ${leadId} not found`);

  const activities = await db
    .select({ kind: leadActivities.kind, body: leadActivities.body, createdAt: leadActivities.createdAt })
    .from(leadActivities)
    .where(eq(leadActivities.leadId, leadId))
    .orderBy(desc(leadActivities.createdAt))
    .limit(30);

  const system = await systemPrompt();
  const user = buildUserMessage(lead, activities);
  const client = anthropic();

  async function attempt(): Promise<LeadScore> {
    const msg = await client.messages.create({
      model: LEAD_SCORING_MODEL,
      max_tokens: 2048,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = messageText(msg).trim();
    // The prompt asks for "ONLY valid JSON" but be defensive about code fences.
    const json = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    return scoreSchema.parse(JSON.parse(json));
  }

  try {
    return await attempt();
  } catch {
    // one retry, then fail the job loudly
    return await attempt();
  }
}

/**
 * Post-processing (docs/02): write score + rationale to the lead, append the
 * full JSON as a note activity. Human gates remain — this never moves a stage.
 */
export async function applyLeadScore(leadId: string, score: LeadScore): Promise<Lead> {
  const [row] = await db
    .update(leads)
    .set({ score: score.score, scoreRationale: score.rationale, updatedAt: new Date() })
    .where(eq(leads.id, leadId))
    .returning();
  await db.insert(leadActivities).values({
    leadId,
    kind: "note",
    body: { text: `AI score: ${score.score} (${score.band})`, score },
  });
  return row!;
}
