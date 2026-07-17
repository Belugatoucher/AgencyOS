import { eq } from "drizzle-orm";
import type { Role } from "@/lib/auth";

// Access layer (docs/00): every user-facing read/write flows through here.
//  - admin/member (internal) see all accounts
//  - client sees only accounts they hold a membership on, and inside those,
//    only records flagged client_visible
// The rule functions are pure (Vitest covers each one); the *Db helpers at the
// bottom bind them to Drizzle. Cross-account denials return not_found, never
// forbidden, so probing can't confirm a record exists (audit item 5).

export type Viewer = {
  id: string;
  role: Role;
  /** account ids the viewer holds a membership on (any role) */
  membershipAccountIds: readonly string[];
};

export function isInternal(viewer: Pick<Viewer, "role">): boolean {
  return viewer.role === "admin" || viewer.role === "member";
}

export function isAdmin(viewer: Pick<Viewer, "role">): boolean {
  return viewer.role === "admin";
}

/** Can the viewer see the account at all (list/detail scope)? */
export function canViewAccount(viewer: Viewer, accountId: string): boolean {
  if (isInternal(viewer)) return true;
  if (viewer.role === "client") return viewer.membershipAccountIds.includes(accountId);
  return false; // unknown roles are denied, not defaulted
}

/**
 * Can the viewer see a specific record inside an account?
 * Records without a client_visible flag (spine records like projects, files)
 * are visible to clients of that account; flagged records require the flag.
 */
export function canViewRecord(
  viewer: Viewer,
  record: { accountId: string; clientVisible?: boolean },
): boolean {
  if (isInternal(viewer)) return true;
  if (!canViewAccount(viewer, record.accountId)) return false;
  if (record.clientVisible === undefined) return true;
  return record.clientVisible;
}

/** Mutations on spine records are internal-only in week 1. */
export function canMutateAccount(viewer: Viewer, accountId: string): boolean {
  void accountId; // clients never mutate spine records regardless of membership
  return isInternal(viewer);
}

/** Account scope for list queries: internal → all, client → memberships. */
export function accessibleAccountIds(viewer: Viewer): "all" | readonly string[] {
  return isInternal(viewer) ? "all" : viewer.membershipAccountIds;
}

// ===== DB-bound helpers =====

export async function loadViewer(user: { id: string; role: Role }): Promise<Viewer> {
  if (user.role === "admin" || user.role === "member") {
    return { id: user.id, role: user.role, membershipAccountIds: [] };
  }
  const { db } = await import("@/lib/db");
  const { memberships } = await import("@/lib/db/schema");
  const rows = await db
    .select({ accountId: memberships.accountId })
    .from(memberships)
    .where(eq(memberships.userId, user.id));
  return { id: user.id, role: user.role, membershipAccountIds: rows.map((r) => r.accountId) };
}
