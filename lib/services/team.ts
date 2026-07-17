import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { isAdmin, isInternal, type Viewer } from "@/lib/access";
import { db } from "@/lib/db";
import { users, type User } from "@/lib/db/schema";
import { err, ok, type Result } from "@/lib/result";
import { sendInviteEmail } from "@/lib/auth/invite-mail";

export const inviteInput = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  name: z.string().trim().min(1).max(200),
  role: z.enum(["admin", "member", "client"]),
});

/** Team roster: internal users only see it; clients have no business here. */
export async function listUsers(viewer: Viewer): Promise<Result<User[]>> {
  if (!isInternal(viewer)) return err("forbidden", "Team roster is internal");
  const rows = await db.select().from(users).orderBy(asc(users.createdAt));
  return ok(rows);
}

/**
 * Invite = create the user row (magic-link auth needs nothing else) and email
 * them a pointer to /login. Members can invite clients; only admins can mint
 * internal users (member/admin) — a member escalating someone to admin is not
 * a week-1 feature anyone asked for.
 */
export async function inviteUser(
  viewer: Viewer,
  input: z.infer<typeof inviteInput>,
): Promise<Result<User>> {
  if (!isInternal(viewer)) return err("forbidden", "Only the team can invite users");
  if (input.role !== "client" && !isAdmin(viewer)) {
    return err("forbidden", "Only an admin can invite team members");
  }
  const [existing] = await db.select().from(users).where(eq(users.email, input.email));
  if (existing) return err("conflict", "A user with that email already exists");
  const [row] = await db.insert(users).values(input).returning();
  await sendInviteEmail(input.email, input.name);
  return ok(row!);
}
