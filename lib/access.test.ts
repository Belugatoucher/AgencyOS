import { describe, expect, it } from "vitest";
import {
  accessibleAccountIds,
  canMutateAccount,
  canViewAccount,
  canViewRecord,
  isAdmin,
  isInternal,
  type Viewer,
} from "./access";

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";

const admin: Viewer = { id: "u1", role: "admin", membershipAccountIds: [] };
const member: Viewer = { id: "u2", role: "member", membershipAccountIds: [] };
const clientOfA: Viewer = { id: "u3", role: "client", membershipAccountIds: [A] };
const clientNoAccounts: Viewer = { id: "u4", role: "client", membershipAccountIds: [] };
// role outside the enum (e.g. bad data) must be denied, not defaulted
const unknownRole = { id: "u5", role: "superuser", membershipAccountIds: [A] } as unknown as Viewer;

describe("role classification", () => {
  it("admin and member are internal; client is not", () => {
    expect(isInternal(admin)).toBe(true);
    expect(isInternal(member)).toBe(true);
    expect(isInternal(clientOfA)).toBe(false);
  });

  it("only admin is admin", () => {
    expect(isAdmin(admin)).toBe(true);
    expect(isAdmin(member)).toBe(false);
    expect(isAdmin(clientOfA)).toBe(false);
  });
});

describe("canViewAccount", () => {
  it("internal users see every account", () => {
    expect(canViewAccount(admin, A)).toBe(true);
    expect(canViewAccount(admin, B)).toBe(true);
    expect(canViewAccount(member, B)).toBe(true);
  });

  it("client sees only accounts they hold a membership on", () => {
    expect(canViewAccount(clientOfA, A)).toBe(true);
    expect(canViewAccount(clientOfA, B)).toBe(false);
    expect(canViewAccount(clientNoAccounts, A)).toBe(false);
  });

  it("unknown roles are denied", () => {
    expect(canViewAccount(unknownRole, A)).toBe(false);
  });
});

describe("canViewRecord", () => {
  it("internal users see records regardless of client_visible", () => {
    expect(canViewRecord(admin, { accountId: A, clientVisible: false })).toBe(true);
    expect(canViewRecord(member, { accountId: B, clientVisible: false })).toBe(true);
  });

  it("client needs membership AND client_visible on flagged records", () => {
    expect(canViewRecord(clientOfA, { accountId: A, clientVisible: true })).toBe(true);
    expect(canViewRecord(clientOfA, { accountId: A, clientVisible: false })).toBe(false);
    expect(canViewRecord(clientOfA, { accountId: B, clientVisible: true })).toBe(false);
  });

  it("client sees unflagged spine records inside their accounts only", () => {
    expect(canViewRecord(clientOfA, { accountId: A })).toBe(true);
    expect(canViewRecord(clientOfA, { accountId: B })).toBe(false);
  });
});

describe("canMutateAccount", () => {
  it("internal users can mutate", () => {
    expect(canMutateAccount(admin, A)).toBe(true);
    expect(canMutateAccount(member, A)).toBe(true);
  });

  it("clients never mutate spine records, even on their own account", () => {
    expect(canMutateAccount(clientOfA, A)).toBe(false);
  });
});

describe("accessibleAccountIds", () => {
  it("internal → all", () => {
    expect(accessibleAccountIds(admin)).toBe("all");
    expect(accessibleAccountIds(member)).toBe("all");
  });

  it("client → membership account ids (possibly empty)", () => {
    expect(accessibleAccountIds(clientOfA)).toEqual([A]);
    expect(accessibleAccountIds(clientNoAccounts)).toEqual([]);
  });
});
