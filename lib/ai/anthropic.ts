import Anthropic from "@anthropic-ai/sdk";

// DECISION: model is configurable via LEAD_SCORING_MODEL, defaulting to the
// current Sonnet (claude-sonnet-5). prompts/lead-scoring.md names
// claude-sonnet-4-6 and "temp 0"; on the current Sonnet, non-default sampling
// params are rejected by the API, so temperature is intentionally omitted.
// The prompt *text* is used verbatim (CLAUDE.md rule 6); only the model id and
// the removed sampling param differ from the frontmatter.
export const LEAD_SCORING_MODEL = process.env.LEAD_SCORING_MODEL ?? "claude-sonnet-5";

let client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  if (!client) client = new Anthropic();
  return client;
}

/** Extract the concatenated text from a Messages API response. */
export function messageText(msg: Anthropic.Message): string {
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}
