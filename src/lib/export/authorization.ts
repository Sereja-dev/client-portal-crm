import "server-only";
import type { Role } from "@/generated/prisma/enums";
import { getEffectivePermission } from "@/lib/permissions/resolver";

/**
 * CSV Import/Export Phase 1, now resolver-backed by Roles / Permissions
 * V1 (locked spec §9/§21) — the DATA_EXPORT catalog key. With zero
 * overrides this reproduces the exact pre-V1 OWNER/ADMIN-only behavior
 * for Client/Lead export (locked spec §6). See this file's own pre-V1
 * doc comment history for why export sits in the privileged tier at all
 * (a data-exfiltration vector, not ordinary single-record CRUD).
 */
export async function canExportData(organizationId: string, role: Role): Promise<boolean> {
  return getEffectivePermission({ organizationId, role, permissionKey: "DATA_EXPORT" });
}
