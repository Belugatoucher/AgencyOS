import { eq } from "drizzle-orm";
import { db } from "../lib/db";
import { accounts, memberships, users } from "../lib/db/schema";

// Idempotent seed: one admin, two members, one demo client account + client user.
// Admin email defaults per HANDOFF kickoff; override with SEED_ADMIN_EMAIL.
const ADMIN_EMAIL = (process.env.SEED_ADMIN_EMAIL ?? "ryan@vngrd.media").toLowerCase();

async function upsertUser(email: string, name: string, role: "admin" | "member" | "client") {
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  if (existing) return existing;
  const [created] = await db.insert(users).values({ email, name, role }).returning();
  return created!;
}

async function main() {
  const admin = await upsertUser(ADMIN_EMAIL, "Ryan", "admin");
  await upsertUser("dana@example.com", "Dana (placeholder)", "member");
  await upsertUser("sam@example.com", "Sam (placeholder)", "member");
  const client = await upsertUser("client@example.com", "Demo Client", "client");

  let [demo] = await db.select().from(accounts).where(eq(accounts.name, "Demo Account"));
  if (!demo) {
    [demo] = await db
      .insert(accounts)
      .values({ name: "Demo Account", timezone: "America/New_York" })
      .returning();
  }

  await db
    .insert(memberships)
    .values({ userId: client.id, accountId: demo!.id, role: "client" })
    .onConflictDoNothing();

  console.log(`seeded: admin=${admin.email}, demo account=${demo!.id}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
