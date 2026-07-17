export const CHANNELS = ["facebook", "instagram", "linkedin", "tiktok", "gbp"] as const;
export type Channel = (typeof CHANNELS)[number];

export type ValidationIssue = { channel: string; message: string };

export type Post = {
  id: string;
  accountId: string;
  channels: string[];
  body: string | null;
  channelOverrides: Record<string, { body?: string }>;
  media: string[] | null;
  scheduledAt: string | null;
  status: string;
  approvalRequired: boolean;
  issues: ValidationIssue[];
};

export type GhostCard = { slotId: string; label: string | null; channels: string[]; date: string };

export const STATUS_COLOR: Record<string, string> = {
  idea: "bg-muted/20 text-muted",
  draft: "bg-background text-foreground",
  in_approval: "bg-warning/15 text-warning",
  approved: "bg-accent/15 text-accent",
  scheduled: "bg-accent/20 text-accent",
  published: "bg-success/15 text-success",
  failed: "bg-destructive/15 text-destructive",
};
