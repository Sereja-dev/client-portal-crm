import type { Role } from "@/generated/prisma/enums";
import { getEffectivePermission } from "@/lib/permissions/resolver";

export type IndustryPresetActor = { id: string; name: string; role: Role };

/**
 * Industry Presets V1, now resolver-backed by Roles / Permissions V1
 * (locked spec §9/§13/§21) for APPLY only — VIEW/PREVIEW
 * (canViewIndustryPresets below) is completely untouched, still
 * unconditionally open to every Staff role (locked spec §9/§13's own
 * explicit requirement: "view/preview remains open to every Staff
 * role"). canApplyIndustryPreset is now backed by the
 * INDUSTRY_PRESETS_APPLY catalog key: OWNER always allowed, ADMIN
 * allowed by default, MEMBER denied by default but grantable by the
 * OWNER at /team/permissions (locked spec §13 — "MEMBER could
 * intentionally be granted Apply"). With zero overrides this reproduces
 * the exact pre-V1 OWNER/ADMIN-only apply behavior (locked spec §6).
 *
 * Applying is still a one-time, effectively irreversible organization-
 * wide mutation, and this check still runs first, before any DB read
 * (apply.ts's own applyIndustryPreset), never trusted from a disabled
 * button alone. Client Portal identities never reach either function at
 * all — every call site lives under the `(dashboard)` route group,
 * whose layout already redirects any Portal-only identity to `/portal`
 * before this module's code ever runs.
 */
export class IndustryPresetAccessError extends Error {
  constructor() {
    super("Industry Presets can only be applied by organization owners and admins.");
    this.name = "IndustryPresetAccessError";
  }
}

/** Any Staff role (OWNER/ADMIN/MEMBER) may view the catalog and preview a preset — never gated by any permission. */
export function canViewIndustryPresets(role: Role): boolean {
  // `role` is intentionally not branched on today (see this function's
  // own doc comment) -- the reference below keeps the parameter a real,
  // checked part of this function's signature, mirroring
  // canApplyQuoteTemplates's own identical "always true, but a real
  // function, not an inlined literal" precedent.
  return role != null;
}

export async function canApplyIndustryPreset(organizationId: string, role: Role): Promise<boolean> {
  return getEffectivePermission({ organizationId, role, permissionKey: "INDUSTRY_PRESETS_APPLY" });
}

/** Throws `IndustryPresetAccessError` when the effective INDUSTRY_PRESETS_APPLY permission is denied — applyIndustryPreset calls this first, before any DB read, so no write below it ever runs for an unauthorized caller. */
export async function assertCanApplyIndustryPreset(organizationId: string, role: Role): Promise<void> {
  if (!(await canApplyIndustryPreset(organizationId, role))) {
    throw new IndustryPresetAccessError();
  }
}
