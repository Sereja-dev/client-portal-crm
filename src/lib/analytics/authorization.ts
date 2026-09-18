import "server-only";
import type { Role } from "@/generated/prisma/enums";
import { getEffectivePermission } from "@/lib/permissions/resolver";

/**
 * Analytics Stage 1 (docs/analytics-architecture.md §7), now resolver-
 * backed by Roles / Permissions V1 (locked spec §9/§21). MEMBER access is
 * no longer a hard block — it's the ANALYTICS_VIEW catalog default
 * (denied for MEMBER, allowed for ADMIN, always allowed for OWNER),
 * configurable per organization by the OWNER at /team/permissions. This
 * is exactly the "MEMBER access should remain configurable later"
 * this module's own doc comment already anticipated before this stage
 * existed — the single call site below is that later stage. With zero
 * overrides this reproduces the exact pre-V1 OWNER/ADMIN-only behavior
 * (locked spec §6). Client Portal identities never reach this at all:
 * every call site lives under the `(dashboard)` route group, whose
 * layout already redirects any Portal-only identity to `/portal` before
 * this function is ever called.
 */
export class AnalyticsAccessError extends Error {
  constructor() {
    super("Analytics is only available to organization owners and admins.");
    this.name = "AnalyticsAccessError";
  }
}

export async function canViewAnalytics(organizationId: string, role: Role): Promise<boolean> {
  return getEffectivePermission({ organizationId, role, permissionKey: "ANALYTICS_VIEW" });
}

/** Throws `AnalyticsAccessError` when the effective ANALYTICS_VIEW permission is denied — every service-layer entry point calls this first, so no query below it ever runs for an unauthorized caller. */
export async function assertCanViewAnalytics(organizationId: string, role: Role): Promise<void> {
  if (!(await canViewAnalytics(organizationId, role))) {
    throw new AnalyticsAccessError();
  }
}
