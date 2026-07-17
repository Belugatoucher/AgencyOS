import { and, eq, gte, isNotNull, lt, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { tasks, users } from "@/lib/db/schema";
import { notify } from "./notifications";

// Daily per-member digest (docs/07 "Daily Slack digest"): due today, overdue,
// awaiting-your-approval. One notification per member — not per-task spam
// (docs/04 rule). Slack mirror is a single line so the webhook stays quiet.

export type MemberDigest = {
  userId: string;
  name: string;
  overdue: number;
  today: number;
  inReview: number;
};

export async function buildDigests(now = new Date()): Promise<MemberDigest[]> {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);

  // Only internal users get a digest; clients don't live in the task tool.
  const members = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(ne(users.role, "client"));

  const digests: MemberDigest[] = [];
  for (const m of members) {
    const assigned = await db
      .select({ status: tasks.status, dueAt: tasks.dueAt, completedAt: tasks.completedAt })
      .from(tasks)
      .where(and(eq(tasks.assigneeId, m.id), ne(tasks.status, "done")));

    let overdue = 0;
    let today = 0;
    let inReview = 0;
    for (const t of assigned) {
      if (t.status === "in_review") inReview++;
      if (t.dueAt) {
        if (t.dueAt < startOfToday) overdue++;
        else if (t.dueAt >= startOfToday && t.dueAt < endOfToday) today++;
      }
    }
    if (overdue || today || inReview) {
      digests.push({ userId: m.id, name: m.name, overdue, today, inReview });
    }
  }
  return digests;
}

export async function sendDailyDigests(now = new Date()): Promise<{ sent: number }> {
  const digests = await buildDigests(now);
  for (const d of digests) {
    const parts: string[] = [];
    if (d.overdue) parts.push(`${d.overdue} overdue`);
    if (d.today) parts.push(`${d.today} due today`);
    if (d.inReview) parts.push(`${d.inReview} awaiting your review`);
    const summary = parts.join(" · ");
    await notify([d.userId], {
      kind: "daily_digest",
      body: { overdue: d.overdue, today: d.today, inReview: d.inReview },
      slackText: `📋 ${d.name}: ${summary}`,
    });
  }
  return { sent: digests.length };
}
