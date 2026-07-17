import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Viewer } from "@/lib/access";
import { hashPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, verifyPassword } from "@/lib/auth/password";
import { db } from "@/lib/db";
import { sessions, users } from "@/lib/db/schema";
import { rateLimit } from "@/lib/rate-limit";
import { err, ok, type Result } from "@/lib/result";

// Portal password login (in addition to magic links, which stay for everyone).
// Security posture mirrors the magic-link/PIN audit items: per-email and
// per-IP rate limits, identical failures (no user enumeration), scrypt.

const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60; // match Auth.js session maxAge

export const setPasswordInput = z.object({
  password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
});

/** A signed-in user sets (or rotates) their own password. */
export async function setPassword(viewer: Viewer, password: string): Promise<Result<{ ok: true }>> {
  const passwordHash = await hashPassword(password);
  await db.update(users).set({ passwordHash }).where(eq(users.id, viewer.id));
  return ok({ ok: true });
}

export const loginInput = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

export type LoginSuccess = { sessionToken: string; expires: Date };

/**
 * Verify email+password and mint a database session (same table Auth.js
 * reads). Failures are indistinguishable: unknown email, no password set,
 * and wrong password all return the same error after a rate-limit check.
 */
export async function loginWithPassword(
  email: string,
  password: string,
  ip: string,
): Promise<Result<LoginSuccess>> {
  const [byEmail, byIp] = await Promise.all([
    rateLimit({ key: `pwlogin:email:${email}`, limit: 5, windowSeconds: 15 * 60 }),
    rateLimit({ key: `pwlogin:ip:${ip}`, limit: 20, windowSeconds: 15 * 60 }),
  ]);
  if (!byEmail.ok || !byIp.ok) return err("rate_limited", "Too many attempts — try again later");

  const [user] = await db.select().from(users).where(eq(users.email, email));
  const stored = user?.passwordHash;
  // Always burn a verification even when the user/hash is missing so timing
  // doesn't leak which emails exist.
  const valid = await verifyPassword(password, stored ?? "scrypt$AAAA$AAAA");
  if (!user || !stored || !valid) return err("unauthorized", "Wrong email or password");

  const sessionToken = randomUUID();
  const expires = new Date(Date.now() + SESSION_MAX_AGE_S * 1000);
  await db.insert(sessions).values({ sessionToken, userId: user.id, expires });
  return ok({ sessionToken, expires });
}
