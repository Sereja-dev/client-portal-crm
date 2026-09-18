import type { Role } from "@/generated/prisma/enums";

/**
 * Roles / Permissions V1 — who may manage the ADMIN/MEMBER permission
 * catalog itself. This is deliberately its own, separate, OWNER-only
 * predicate — never one of the 9 configurable catalog permissions
 * (locked spec §3: "Roles / Permissions administration" is explicitly
 * listed among the immutable OWNER-only capabilities that must NOT
 * become configurable) and never reused from an unrelated domain's own
 * helper (e.g. canAccessPaymentDetails), matching this codebase's own
 * "each domain gets its own named predicate" convention (see
 * src/lib/reports/authorization.ts's own doc comment on exactly this
 * reasoning for why Reports doesn't reuse Export/Import's predicate
 * either).
 */
export class RolePermissionManagementAccessError extends Error {
  constructor() {
    super("Roles & permissions can only be managed by the organization owner.");
    this.name = "RolePermissionManagementAccessError";
  }
}

export function canManageRolePermissions(role: Role): boolean {
  return role === "OWNER";
}

/** Throws `RolePermissionManagementAccessError` for ADMIN/MEMBER — the /team/permissions page and updateRolePermissionsAction both call this first, before any read/write. */
export function assertCanManageRolePermissions(role: Role): void {
  if (!canManageRolePermissions(role)) {
    throw new RolePermissionManagementAccessError();
  }
}
