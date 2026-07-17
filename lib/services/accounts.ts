import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  accessibleAccountIds,
  canMutateAccount,
  canViewAccount,
  isAdmin,
  type Viewer,
} from "@/lib/access";
import { db } from "@/lib/db";
import { accounts, type Account } from "@/lib/db/schema";
import { err, ok, type Result } from "@/lib/result";

export const accountInput = z.object({
  name: z.string().trim().min(1).max(200),
  timezone: z.string().trim().min(1).max(64).default("America/New_York"),
});

export async function listAccounts(viewer: Viewer): Promise<Result<Account[]>> {
  const scope = accessibleAccountIds(viewer);
  if (scope !== "all" && scope.length === 0) return ok([]);
  const rows = await db
    .select()
    .from(accounts)
    .where(
      scope === "all"
        ? isNull(accounts.deletedAt)
        : and(isNull(accounts.deletedAt), inArray(accounts.id, [...scope])),
    )
    .orderBy(desc(accounts.createdAt));
  return ok(rows);
}

export async function getAccount(viewer: Viewer, id: string): Promise<Result<Account>> {
  // not_found (not forbidden) on cross-account access — audit item 5
  if (!canViewAccount(viewer, id)) return err("not_found", "Account not found");
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), isNull(accounts.deletedAt)));
  if (!row) return err("not_found", "Account not found");
  return ok(row);
}

export async function createAccount(
  viewer: Viewer,
  input: z.infer<typeof accountInput>,
): Promise<Result<Account>> {
  if (!canMutateAccount(viewer, "")) return err("forbidden", "Only the team can create accounts");
  const [row] = await db.insert(accounts).values(input).returning();
  return ok(row!);
}

export async function updateAccount(
  viewer: Viewer,
  id: string,
  input: Partial<z.infer<typeof accountInput>>,
): Promise<Result<Account>> {
  if (!canViewAccount(viewer, id)) return err("not_found", "Account not found");
  if (!canMutateAccount(viewer, id)) return err("forbidden", "Only the team can edit accounts");
  const [row] = await db
    .update(accounts)
    .set(input)
    .where(and(eq(accounts.id, id), isNull(accounts.deletedAt)))
    .returning();
  if (!row) return err("not_found", "Account not found");
  return ok(row);
}

export async function softDeleteAccount(viewer: Viewer, id: string): Promise<Result<Account>> {
  if (!canViewAccount(viewer, id)) return err("not_found", "Account not found");
  if (!isAdmin(viewer)) return err("forbidden", "Only an admin can delete an account");
  const [row] = await db
    .update(accounts)
    .set({ deletedAt: new Date() })
    .where(and(eq(accounts.id, id), isNull(accounts.deletedAt)))
    .returning();
  if (!row) return err("not_found", "Account not found");
  return ok(row);
}
