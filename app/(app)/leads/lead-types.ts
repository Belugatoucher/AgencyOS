export type Stage = {
  id: string;
  pipelineId: string;
  name: string;
  color: string | null;
  position: number;
  isWon: boolean;
  isLost: boolean;
};

export type Pipeline = {
  id: string;
  accountId: string;
  name: string;
  position: number;
  intakeToken: string | null;
  stages: Stage[];
};

export type LeadRow = {
  id: string;
  accountId: string | null;
  pipelineUuid: string | null;
  stageUuid: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  valueCents: number | null;
  source: string | null;
  tags: string[] | null;
  ownerId: string | null;
  ownerName: string | null;
  stageName: string | null;
  score: number | null;
  scoreRationale: string | null;
  nextActionAt: string | null;
  internalNotes: string | null;
  clientHidden: boolean;
  createdAt: string;
  updatedAt: string;
};

export type LeadActivity = {
  id: string;
  kind: string;
  body: Record<string, unknown>;
  actorId: string | null;
  createdAt: string;
};

export type PipelineOverview = {
  pipelineId: string;
  pipelineName: string;
  accountId: string | null;
  leadCount: number;
  openValueCents: number;
  wonThisMonth: number;
  noNextAction: number;
  stalestUpdatedAt: string | null;
};

export function money(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function nextActionTone(nextActionAt: string | null): string {
  if (!nextActionAt) return "text-muted";
  return new Date(nextActionAt) < new Date() ? "text-destructive" : "text-foreground";
}

export function scoreBand(score: number | null): { label: string; tone: string } | null {
  if (score == null) return null;
  if (score >= 75) return { label: `${score} hot`, tone: "text-destructive" };
  if (score >= 50) return { label: `${score} warm`, tone: "text-warning" };
  if (score >= 25) return { label: `${score} cool`, tone: "text-accent" };
  return { label: `${score}`, tone: "text-muted" };
}
