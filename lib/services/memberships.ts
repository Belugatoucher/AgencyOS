import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { canMutateAccount, canViewAccount, type Viewer } from "@/lib/access";
import { db } from "@/lib/db";
import { memberships, users } from "@/lib/db/schema";
import { err, ok, type Result } from "@/lib/result";
import { inviteUser } from "./team";

export type MemberRow = {
  userId: string;
  accountId: string;
  role: string;
  name: string;
  email: string;
};

export const addMemberInput = z.object({
  // either an existing user id, or an email+name to invite on the spot
  userId: z.string().uuid().optional(),
  email: z.string().trim().toLowerCase().email().max(320).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  role: z.enum(["member", "client"]).default("client"),
});

export async function listMembers(viewer: Viewer, accountId: string): Promise<Result<MemberRow[]>> {
  if (!canViewAccount(viewer, accountId)) return err("not_found", "Account not found");
  const rows = await db
    .select({
      userId: memberships.userId,
      accountId: memberships.accountId,
      role: memberships.role,
      name: users.name,
      email: users.email,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.accountId, accountId));
  return ok(rows);
}

/**
 * Add a person to an account. With `userId`, links an existing user; with
 * `email`+`name`, invites a new one (client contacts get created here — the
 * docs/00 client invite flow). Membership role mirrors the user's platform
 * role for clients.
 */
export async function addMember(
  viewer: Viewer,
  accountId: string,
  input: z.infer<typeof addMemberInput>,
): Promise<Result<MemberRow>> {
  if (!canViewAccount(viewer, accountId)) return err("not_found", "Account not found");
  if (!canMutateAccount(viewer, accountId)) {
    return err("forbidden", "Only the team can manage members");
  }

  let userId = input.userId;
  if (!userId) {
    if (!input.email || !input.name) {
      return err("invalid", "Provide a user or an email and name to invite");
    }
    const [existing] = await db.select().from(users).where(eq(users.email, input.email));
    if (existing) {
      userId = existing.id;
    } else {
      const invited = await inviteUser(viewer, {
        email: input.email,
        name: input.name,
        role: input.role,
      });
      if (!invited.ok) return invited as Result<never>;
      userId = invited.value.id;
    }
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return err("not_found", "User not found");

  await db
    .insert(memberships)
    .values({ userId, accountId, role: input.role })
    .onConflictDoNothing();

  return ok({ userId, accountId, role: input.role, name: user.name, email: user.email });
}

export async function removeMember(
  viewer: Viewer,
  accountId: string,
  userId: string,
): Promise<Result<{ removed: true }>> {
  if (!canViewAccount(viewer, accountId)) return err("not_found", "Account not found");
  if (!canMutateAccount(viewer, accountId)) {
    return err("forbidden", "Only the team can manage members");
  }
  await db
    .delete(memberships)
    .where(and(eq(memberships.accountId, accountId), eq(memberships.userId, userId)));
  return ok({ removed: true });
}
