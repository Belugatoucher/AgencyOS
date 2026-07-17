// Minimal RRULE evaluator for recurring tasks (docs/04 examples:
// FREQ=WEEKLY;BYDAY=TU,TH,SA, "report every 1st", weekly call prep).
// Supports FREQ=DAILY|WEEKLY|MONTHLY, INTERVAL, BYDAY (weekly), BYMONTHDAY
// (monthly). Deliberately not a full RFC 5545 implementation — if a rule needs
// more, reach for the `rrule` package and revisit. Times computed in UTC.

const DAY_CODES: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

type ParsedRule = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY";
  interval: number;
  byDay?: number[]; // 0=Sun..6=Sat
  byMonthDay?: number[];
};

export function parseRRule(rrule: string): ParsedRule | null {
  const parts = Object.fromEntries(
    rrule
      .replace(/^RRULE:/i, "")
      .split(";")
      .map((p) => p.split("="))
      .filter((kv) => kv.length === 2)
      .map(([k, v]) => [k!.toUpperCase(), v!.toUpperCase()]),
  );
  const freq = parts.FREQ as ParsedRule["freq"] | undefined;
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY") return null;
  const interval = parts.INTERVAL ? Math.max(1, parseInt(parts.INTERVAL, 10) || 1) : 1;
  const rule: ParsedRule = { freq, interval };
  if (parts.BYDAY) {
    const days = parts.BYDAY.split(",")
      .map((d) => DAY_CODES[d.trim()])
      .filter((n): n is number => n !== undefined);
    if (days.length) rule.byDay = days;
  }
  if (parts.BYMONTHDAY) {
    const md = parts.BYMONTHDAY.split(",")
      .map((d) => parseInt(d.trim(), 10))
      .filter((n) => n >= 1 && n <= 31);
    if (md.length) rule.byMonthDay = md;
  }
  return rule;
}

function addDaysUTC(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * First occurrence strictly after `after`. Preserves the time-of-day of `after`
 * for daily/weekly; monthly uses the day-of-month from BYMONTHDAY at that time.
 * Returns null if the rule is invalid or yields nothing within a safe horizon.
 */
export function nextOccurrence(rrule: string, after: Date): Date | null {
  const rule = parseRRule(rrule);
  if (!rule) return null;

  if (rule.freq === "DAILY") {
    return addDaysUTC(after, rule.interval);
  }

  if (rule.freq === "WEEKLY") {
    const byDay = rule.byDay ?? [after.getUTCDay()];
    // scan forward day by day; cap at interval*7 + 7 days to stay bounded
    for (let i = 1; i <= rule.interval * 7 + 7; i++) {
      const cand = addDaysUTC(after, i);
      if (byDay.includes(cand.getUTCDay())) {
        // for INTERVAL>1, ensure we're in an "on" week relative to `after`
        if (rule.interval === 1) return cand;
        const weeks = Math.floor((cand.getTime() - after.getTime()) / (7 * 24 * 60 * 60 * 1000));
        if (weeks % rule.interval === 0 || i >= 7) return cand;
      }
    }
    return null;
  }

  // MONTHLY
  const byMonthDay = rule.byMonthDay ?? [after.getUTCDate()];
  for (let m = 0; m <= rule.interval + 1; m++) {
    const base = new Date(
      Date.UTC(after.getUTCFullYear(), after.getUTCMonth() + (m === 0 ? 0 : rule.interval * m), 1,
        after.getUTCHours(), after.getUTCMinutes(), after.getUTCSeconds()),
    );
    const year = base.getUTCFullYear();
    const month = base.getUTCMonth();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const candidates = byMonthDay
      .filter((d) => d <= daysInMonth)
      .map((d) => new Date(Date.UTC(year, month, d, after.getUTCHours(), after.getUTCMinutes(), after.getUTCSeconds())))
      .filter((c) => c.getTime() > after.getTime())
      .sort((a, b) => a.getTime() - b.getTime());
    if (candidates.length) return candidates[0]!;
  }
  return null;
}
