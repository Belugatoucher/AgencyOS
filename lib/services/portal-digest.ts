import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";
import { and, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts, memberships, posts, users } from "@/lib/db/schema";
import { getPortalHome } from "@/lib/services/portal";
import { notify } from "@/lib/services/notifications";
import type { Viewer } from "@/lib/access";

// Weekly client digest (docs/11): what shipped + what needs their eyes,
// per client contact, settable per account (accounts.portal_digest weekly|off).
// Runs from the cron queue; email via SMTP_URL with the same dev-mailbox
// fallback as magic links/invites.

type ClientDigest = {
  accountId: string;
  accountName: string;
  to: { userId: string; email: string; name: string }[];
  shippedPosts: number;
  awaitingReviews: number;
  awaitingPosts: number;
  openTasks: number;
};

export async function buildClientDigests(now = new Date()): Promise<ClientDigest[]> {
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const rows = await db.select().from(accounts).where(eq(accounts.portalDigest, "weekly"));
  const digests: ClientDigest[] = [];

  for (const account of rows) {
    if (account.deletedAt) continue;
    const contacts = await db
      .select({ userId: users.id, email: users.email, name: users.name })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.accountId, account.id), eq(users.role, "client")));
    if (contacts.length === 0) continue;

    // "what shipped": published in the last 7 days
    const shipped = await db
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.accountId, account.id), eq(posts.status, "published"), gte(posts.publishedAt, weekAgo)));

    // "what needs their eyes": the same action stack the portal home renders,
    // computed as a synthetic client viewer so client rules apply exactly.
    const asClient: Viewer = { id: contacts[0]!.userId, role: "client", membershipAccountIds: [account.id] };
    const home = await getPortalHome(asClient, account.id);
    if (!home.ok) continue;

    const digest: ClientDigest = {
      accountId: account.id,
      accountName: account.name,
      to: contacts,
      shippedPosts: shipped.length,
      awaitingReviews: home.value.reviewsAwaiting.length,
      awaitingPosts: home.value.postsAwaiting.length,
      openTasks: home.value.tasksFlagged.length,
    };
    // Quiet weeks send nothing — a digest of zeros trains people to ignore it.
    if (digest.shippedPosts + digest.awaitingReviews + digest.awaitingPosts + digest.openTasks > 0) {
      digests.push(digest);
    }
  }
  return digests;
}

function digestText(d: ClientDigest): string {
  const lines = [`Your weekly update from the team:`];
  if (d.shippedPosts) lines.push(`• ${d.shippedPosts} post(s) went live this week`);
  if (d.awaitingReviews) lines.push(`• ${d.awaitingReviews} review(s) are waiting for your approval`);
  if (d.awaitingPosts) lines.push(`• ${d.awaitingPosts} post(s) are waiting for your approval`);
  if (d.openTasks) lines.push(`• ${d.openTasks} item(s) are on your plate`);
  lines.push("", `Sign in to your portal to take a look.`);
  return lines.join("\n");
}

async function sendDigestEmail(to: string, accountName: string, body: string): Promise<void> {
  const smtpUrl = process.env.SMTP_URL;
  if (!smtpUrl) {
    if (process.env.NODE_ENV === "production" && process.env.DEV_MAILBOX !== "1") {
      throw new Error("SMTP_URL is required in production");
    }
    const dir = path.join(process.cwd(), ".dev-mail");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "last-digest.txt"), `${to}\n${body}\n`);
    console.log(`[dev-mail] client digest for ${to}`);
    return;
  }
  const transport = nodemailer.createTransport(smtpUrl);
  await transport.sendMail({
    from: process.env.EMAIL_FROM ?? "Agency OS <no-reply@localhost>",
    to,
    subject: `Your weekly update — ${accountName}`,
    text: body,
  });
}

/** Cron entry: build + send all weekly client digests. */
export async function sendClientDigests(): Promise<{ accounts: number; emails: number }> {
  const digests = await buildClientDigests();
  let emails = 0;
  for (const d of digests) {
    const body = digestText(d);
    for (const contact of d.to) {
      await sendDigestEmail(contact.email, d.accountName, body);
      emails++;
    }
    await notify(
      d.to.map((c) => c.userId),
      { kind: "client_digest", body: { accountId: d.accountId, shipped: d.shippedPosts } },
    );
  }
  return { accounts: digests.length, emails };
}
