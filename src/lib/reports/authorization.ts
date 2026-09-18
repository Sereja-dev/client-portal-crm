import "server-only";
import type { Role } from "@/generated/prisma/enums";
import { getEffectivePermission } from "@/lib/permissions/resolver";

/**
 * Reports Phase 1, now resolver-backed by Roles / Permissions V1 (locked
 * spec §9/§21). Still its own semantic authorization boundary — the
 * REPORTS_VIEW catalog key, deliberately NOT the same key as
 * ANALYTICS_VIEW/DATA_IMPORT/DATA_EXPORT despite sharing the same
 * OWNER/ADMIN default, for the exact reason this module already
 * documented pre-V1: Reports/Analytics/Export/Import are four
 * independently-configurable concerns that should be free to diverge per
 * organization (an OWNER loosening one must never accidentally loosen
 * the others). With zero overrides this reproduces the exact pre-V1
 * OWNER/ADMIN-only behavior (locked spec §6). Client Portal identities
 * never reach this at all — every future Reports call site lives under
 * the `(dashboard)` route group, whose layout already redirects any
 * Portal-only identity to `/portal` before any Reports code is ever
 * called.
 */
export class ReportsAccessError extends Error {
  constructor() {
    super("Reports is only available to organization owners and admins.");
    this.name = "ReportsAccessError";
  }
}

export async function canViewReports(organizationId: string, role: Role): Promise<boolean> {
  return getEffectivePermission({ organizationId, role, permissionKey: "REPORTS_VIEW" });
}

/** Throws `ReportsAccessError` when the effective REPORTS_VIEW permission is denied — every Reports query entry point calls this first, so no query below it ever runs for an unauthorized caller. */
export async function assertCanViewReports(organizationId: string, role: Role): Promise<void> {
  if (!(await canViewReports(organizationId, role))) {
    throw new ReportsAccessError();
  }
}
