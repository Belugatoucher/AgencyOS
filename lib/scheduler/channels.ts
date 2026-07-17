// Per-channel constraints checked at draft time, not at publish failure (docs/06).
export const CHANNELS = ["facebook", "instagram", "linkedin", "tiktok", "gbp"] as const;
export type Channel = (typeof CHANNELS)[number];

const BODY_LIMITS: Record<Channel, number> = {
  facebook: 63206,
  instagram: 2200,
  linkedin: 3000,
  tiktok: 150, // caption
  gbp: 1500,
};

// Channels that require at least one media asset to post.
const MEDIA_REQUIRED: Channel[] = ["instagram", "tiktok"];

export type ValidationIssue = { channel: Channel; message: string };

/** Validate a post's per-channel bodies + media against each channel's rules. */
export function validatePost(input: {
  channels: string[];
  body: string | null;
  channelOverrides: Record<string, { body?: string }>;
  mediaCount: number;
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const ch of input.channels) {
    if (!(CHANNELS as readonly string[]).includes(ch)) {
      issues.push({ channel: ch as Channel, message: "Unknown channel" });
      continue;
    }
    const channel = ch as Channel;
    const body = input.channelOverrides[channel]?.body ?? input.body ?? "";
    if (body.length === 0 && input.mediaCount === 0) {
      issues.push({ channel, message: "Needs body text or media" });
    }
    if (body.length > BODY_LIMITS[channel]) {
      issues.push({ channel, message: `Body exceeds ${BODY_LIMITS[channel]} chars (${body.length})` });
    }
    if (MEDIA_REQUIRED.includes(channel) && input.mediaCount === 0) {
      issues.push({ channel, message: `${channel} requires at least one media asset` });
    }
  }
  return issues;
}
