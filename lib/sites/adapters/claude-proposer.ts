import { readFile } from "node:fs/promises";
import path from "node:path";
import { anthropic, messageText } from "@/lib/ai/anthropic";
import { designSystemDraft, type DesignProposer, type DesignSystemDraft, type ProposalInput } from "@/lib/sites/types";

// Default DesignProposer: prompts/sites-design-system.md verbatim (CLAUDE.md
// rule 6), runtime context filled into its template, JSON parsed with one
// retry then a loud failure.
// DECISION: model via SITES_DESIGN_MODEL defaulting to the current Sonnet,
// same reasoning as LEAD_SCORING_MODEL (sampling params omitted).
export const SITES_DESIGN_MODEL = process.env.SITES_DESIGN_MODEL ?? "claude-sonnet-5";

const MAX_PAGES_IN_PROMPT = 40;
const MAX_TEXT_PER_PAGE = 600;

let cached: { system: string; template: string } | null = null;
async function promptParts() {
  if (cached) return cached;
  const md = await readFile(path.join(process.cwd(), "prompts", "sites-design-system.md"), "utf8");
  const system = md.match(/## System prompt\s*\n+```\n([\s\S]*?)\n```/)?.[1];
  const template = md.match(/## Runtime context \(user message\)\s*\n+```\n([\s\S]*?)\n```/)?.[1];
  if (!system || !template) throw new Error("Could not parse prompts/sites-design-system.md");
  cached = { system: system.trim(), template: template.trim() };
  return cached;
}

export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? "");
}

export function buildProposalMessage(template: string, input: ProposalInput): string {
  const snap = input.snapshot;
  const pages = (snap?.pages ?? [])
    .slice(0, MAX_PAGES_IN_PROMPT)
    .map(
      (p) =>
        `- ${p.url}\n  title: ${p.title ?? "(none)"} · h1: ${p.h1 ?? "(none)"} · words: ${p.wordCount}\n  headings: ${p.headings.slice(0, 8).join(" | ")}\n  text: ${p.text.slice(0, MAX_TEXT_PER_PAGE)}`,
    )
    .join("\n");
  const previous = input.previous
    ? `Previous proposal (rejected) — team note: ${input.previousNote ?? "(no note)"}\n${JSON.stringify(input.previous)}`
    : "";
  return fillTemplate(template, {
    account_name: input.accountName,
    site_name: input.siteName,
    brief: input.brief?.trim() || "(none — use your judgment from the crawl)",
    brand_json: JSON.stringify(input.brand ?? {}),
    page_count: String(snap?.pages.length ?? 0),
    colors: snap ? snap.brand.colors.map((c) => `${c.value}×${c.count}`).join(", ") || "(none found)" : "(no crawl — new site)",
    fonts: snap?.brand.fonts.join(", ") || "(none found)",
    logo_url: snap?.brand.logoUrl ?? "(none)",
    favicon_url: snap?.brand.faviconUrl ?? "(none)",
    theme_color: snap?.brand.themeColor ?? "(none)",
    audit_json: JSON.stringify(snap?.audit ?? {}),
    pages: pages || "(no pages — starting from scratch)",
    previous_block: previous,
  });
}

export const claudeProposer: DesignProposer = {
  id: "claude",
  async propose(input: ProposalInput): Promise<DesignSystemDraft> {
    const { system, template } = await promptParts();
    const user = buildProposalMessage(template, input);
    const client = anthropic();

    async function attempt(extra?: string): Promise<DesignSystemDraft> {
      const msg = await client.messages.create({
        model: SITES_DESIGN_MODEL,
        max_tokens: 8000,
        system,
        messages: [{ role: "user", content: extra ? `${user}\n\n${extra}` : user }],
      });
      const text = messageText(msg).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
      return designSystemDraft.parse(JSON.parse(text));
    }

    try {
      return await attempt();
    } catch (first) {
      const why = first instanceof Error ? first.message.slice(0, 500) : "invalid output";
      return attempt(`Your previous reply could not be used (${why}). Return ONLY the JSON object described, nothing else.`);
    }
  },
};
