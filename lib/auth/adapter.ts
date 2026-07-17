import { and, eq } from "drizzle-orm";
import type { Adapter, AdapterSession, AdapterUser } from "next-auth/adapters";
import { db } from "@/lib/db";
import { sessions, users, verificationTokens } from "@/lib/db/schema";

// DECISION: custom minimal adapter instead of @auth/drizzle-adapter.
// We only run the email (magic link) provider with database sessions, so the
// oauth `accounts` table the stock adapter demands is dead weight — and its
// name collides with the domain `accounts` (client companies) table.

// Carries `role` beyond the AdapterUser shape so the session callback can
// expose it without a second query.
function toAdapterUser(u: typeof users.$inferSelect): AdapterUser & { role: string } {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    emailVerified: u.emailVerified,
    image: null,
    role: u.role,
  };
}

export function authAdapter(): Adapter {
  return {
    async createUser() {
      // Users are invite-only (seeded or created via the invite flow).
      // Delivery is already gated on an existing user in sendVerificationRequest;
      // this is defense in depth (audit item 3).
      throw new Error("Sign-ups are invite-only");
    },
    async getUser(id) {
      const [u] = await db.select().from(users).where(eq(users.id, id));
      return u ? toAdapterUser(u) : null;
    },
    async getUserByEmail(email) {
      const [u] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
      return u ? toAdapterUser(u) : null;
    },
    async getUserByAccount() {
      return null; // no oauth providers
    },
    async updateUser(partial) {
      const [u] = await db
        .update(users)
        .set({
          ...(partial.email ? { email: partial.email.toLowerCase() } : {}),
          ...(partial.name != null ? { name: partial.name } : {}),
          ...(partial.emailVerified !== undefined ? { emailVerified: partial.emailVerified } : {}),
        })
        .where(eq(users.id, partial.id))
        .returning();
      if (!u) throw new Error("User not found");
      return toAdapterUser(u);
    },
    async linkAccount() {
      throw new Error("OAuth providers are not configured");
    },
    async createSession(session) {
      const [s] = await db.insert(sessions).values(session).returning();
      return s as AdapterSession;
    },
    async getSessionAndUser(sessionToken) {
      const [row] = await db
        .select({ session: sessions, user: users })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(eq(sessions.sessionToken, sessionToken));
      if (!row || row.session.expires < new Date()) return null;
      return { session: row.session as AdapterSession, user: toAdapterUser(row.user) };
    },
    async updateSession(partial) {
      const [s] = await db
        .update(sessions)
        .set(partial)
        .where(eq(sessions.sessionToken, partial.sessionToken))
        .returning();
      return (s as AdapterSession) ?? null;
    },
    async deleteSession(sessionToken) {
      await db.delete(sessions).where(eq(sessions.sessionToken, sessionToken));
    },
    async createVerificationToken(token) {
      const [t] = await db.insert(verificationTokens).values(token).returning();
      return t!;
    },
    async useVerificationToken({ identifier, token }) {
      // Single-use: delete-and-return in one statement (audit item 3).
      const [t] = await db
        .delete(verificationTokens)
        .where(and(eq(verificationTokens.identifier, identifier), eq(verificationTokens.token, token)))
        .returning();
      return t ?? null;
    },
  };
}
