import { and, isNotNull, lte, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { assets, users } from "@/lib/db/schema";
import { notify } from "./notifications";

// Weekly rights-expiry sweep (docs/05): flag assets expiring within 30 days and
// any asset already expired but still marked approved. Notifies internal users
// (one digest-style notification per run, to admins/members).
export async function flagExpiringAssets(now = new Date()): Promise<{ expiring: number; expiredApproved: number }> {
  const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const expiring = await db
    .select({ id: assets.id, accountId: assets.accountId, expiresAt: assets.expiresAt })
    .from(assets)
    .where(and(isNotNull(assets.expiresAt), lte(assets.expiresAt, in30), ne(assets.status, "archived")));

  const expiredApproved = expiring.filter(
    (a) => a.expiresAt && a.expiresAt < now,
  );

  if (expiring.length > 0) {
    // notify internal users of the account(s) with expiring rights
    const internal = await db
      .select({ id: users.id })
      .from(users)
      .where(ne(users.role, "client"));
    void notify(
      internal.map((u) => u.id),
      {
        kind: "assets_expiring",
        body: { expiring: expiring.length, expiredApproved: expiredApproved.length },
        slackText: `⏳ ${expiring.length} asset(s) expiring within 30 days${expiredApproved.length ? `, ${expiredApproved.length} already expired but still approved` : ""}`,
      },
    );
  }
  return { expiring: expiring.length, expiredApproved: expiredApproved.length };
}
