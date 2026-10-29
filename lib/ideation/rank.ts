// Ideation ranking + cleanup (docs/19). Pure — no imports — unit-tested in
// rank.test.ts. The model scores impact/effort/alignment; this module decides
// order and sanity-checks what it returned, so the ranking is predictable and
// doesn't depend on how the model happened to order its list.

export type Alignment = "advances" | "new_direction" | "off_strategy";
export type Horizon = "now" | "this_week" | "this_month" | "this_quarter" | "later";
export type ItemKind = "action" | "goal" | "idea" | "question" | "risk";

export type RankableItem = {
  kind: ItemKind;
  alignment: Alignment;
  impact: number | null;
  effort: number | null;
  horizon: Horizon | null;
};

const ALIGN_WEIGHT: Record<Alignment, number> = { advances: 1, new_direction: 0.7, off_strategy: 0.25 };
const HORIZON_BOOST: Record<Horizon, number> = { now: 1.3, this_week: 1.15, this_month: 1, this_quarter: 0.9, later: 0.75 };

const clamp15 = (n: number | null | undefined, fallback = 3) =>
  typeof n === "number" && Number.isFinite(n) ? Math.min(5, Math.max(1, Math.round(n))) : fallback;

/**
 * Priority score for "Do next": alignment × impact ÷ effort, nudged by urgency.
 * Range roughly 0.1–6.5. A 5-impact/1-effort action that advances a goal and
 * is due now tops the list; an off-strategy idea sinks however exciting it is.
 */
export function priorityScore(i: RankableItem): number {
  const impact = clamp15(i.impact);
  const effort = clamp15(i.effort);
  const score = ALIGN_WEIGHT[i.alignment] * (impact * 2) / (effort + 1) * HORIZON_BOOST[i.horizon ?? "this_month"];
  return Math.round(score * 100) / 100;
}

export function rankItems<T extends RankableItem>(items: T[]): T[] {
  return items
    .map((item, idx) => ({ item, idx, s: priorityScore(item) }))
    .sort((a, b) => b.s - a.s || a.idx - b.idx)
    .map((x) => x.item);
}

export type Grouped<T> = { doNext: T[]; goals: T[]; park: T[]; questions: T[]; flags: T[] };

/** Review groups: actions that aren't off-strategy are "Do next"; off-strategy anything goes to flags. */
export function groupItems<T extends RankableItem>(items: T[]): Grouped<T> {
  const ranked = rankItems(items);
  const g: Grouped<T> = { doNext: [], goals: [], park: [], questions: [], flags: [] };
  for (const i of ranked) {
    if (i.kind === "risk" || i.alignment === "off_strategy") g.flags.push(i);
    else if (i.kind === "action") g.doNext.push(i);
    else if (i.kind === "goal") g.goals.push(i);
    else if (i.kind === "question") g.questions.push(i);
    else g.park.push(i);
  }
  return g;
}

/**
 * Keep a model-suggested due date only if it's a real YYYY-MM-DD date that
 * isn't in the past and isn't absurdly far out (> 2 years).
 */
export function cleanDueDate(raw: string | null | undefined, todayIso: string): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) return null;
  if (raw < todayIso) return null;
  const max = new Date(`${todayIso}T00:00:00Z`);
  max.setUTCFullYear(max.getUTCFullYear() + 2);
  return d > max ? null : raw;
}

/** Drop a goal_id the model invented (not one of the active goals it was given). */
export function cleanGoalId(raw: string | null | undefined, activeGoalIds: readonly string[]): string | null {
  return raw && activeGoalIds.includes(raw) ? raw : null;
}

/** Today's date + weekday in a given IANA zone, for "by Friday"-style resolution. */
export function todayIn(timeZone: string, now = new Date()): { iso: string; weekday: string } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "long" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { iso: `${get("year")}-${get("month")}-${get("day")}`, weekday: get("weekday") };
}

/** Fill {{name}} placeholders; unknown names become empty strings. */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? "");
}

/** Collapse whisper segments into readable text, capped so one ramble can't blow the prompt. */
export function segmentsToText(segments: { text: string }[], maxChars = 60_000): string {
  const text = segments
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)} …[cut]` : text;
}
