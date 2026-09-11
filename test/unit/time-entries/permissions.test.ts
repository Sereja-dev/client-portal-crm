import { describe, expect, it } from "vitest";
import { canManageTimeEntry, isPrivilegedRole } from "@/lib/time-entries/permissions";

describe("37/38. canManageTimeEntry — UI manage-controls visibility mirrors the Phase 1 domain rule", () => {
  it("37. a MEMBER viewing another member's entry cannot manage it", () => {
    expect(canManageTimeEntry("other-user-id", "actor-id", "MEMBER")).toBe(false);
  });

  it("a MEMBER can manage their own entry", () => {
    expect(canManageTimeEntry("actor-id", "actor-id", "MEMBER")).toBe(true);
  });

  it("38. an OWNER/ADMIN can manage any member's entry", () => {
    expect(canManageTimeEntry("other-user-id", "actor-id", "OWNER")).toBe(true);
    expect(canManageTimeEntry("other-user-id", "actor-id", "ADMIN")).toBe(true);
  });

  it("a null entry owner (historical, deleted User) is never treated as 'mine' by anyone but OWNER/ADMIN", () => {
    expect(canManageTimeEntry(null, "actor-id", "MEMBER")).toBe(false);
    expect(canManageTimeEntry(null, "actor-id", "OWNER")).toBe(true);
  });
});

describe("isPrivilegedRole", () => {
  it("true for OWNER/ADMIN, false for MEMBER", () => {
    expect(isPrivilegedRole("OWNER")).toBe(true);
    expect(isPrivilegedRole("ADMIN")).toBe(true);
    expect(isPrivilegedRole("MEMBER")).toBe(false);
  });
});
