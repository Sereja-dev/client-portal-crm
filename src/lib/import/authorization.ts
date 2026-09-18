import "server-only";
import type { Role } from "@/generated/prisma/enums";
import { getEffectivePermission } from "@/lib/permissions/resolver";

/**
 * CSV Import Phase 2, now resolver-backed by Roles / Permissions V1
 * (locked spec §9/§21) — the DATA_IMPORT catalog key. With zero
 * overrides this reproduces the exact pre-V1 OWNER/ADMIN-only behavior
 * for Client/Lead import (locked spec §6). MEMBER is denied by default;
 * Portal has no access at all (Portal identities never reach this code
 * path — see getCurrentMembership()'s own redirect-to-/portal behavior).
 */
export async function canImportData(organizationId: string, role: Role): Promise<boolean> {
  return getEffectivePermission({ organizationId, role, permissionKey: "DATA_IMPORT" });
}
