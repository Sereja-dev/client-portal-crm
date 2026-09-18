import type { Role } from "@/generated/prisma/enums";
import { getEffectivePermission } from "@/lib/permissions/resolver";

export type QuoteTemplateActor = { id: string; name: string; role: Role };

/**
 * Quote Templates Phase 1, now resolver-backed by Roles / Permissions V1
 * (locked spec §9/§21) — the QUOTE_TEMPLATES_MANAGE catalog key. Governs
 * management (create/edit/archive/restore/duplicate) ONLY — APPLICATION
 * (canApplyQuoteTemplates below, using an ACTIVE template to prefill a
 * new Quote) is untouched, still unconditionally open to any Staff role
 * already permitted to create a Quote (locked spec §9's own explicit "do
 * NOT change canApplyQuoteTemplates" requirement). With zero overrides
 * this reproduces the exact pre-V1 OWNER/ADMIN-only management behavior
 * (locked spec §6).
 *
 * MEMBER is denied by default for management only. Client Portal
 * identities never reach either function at all — every Quote Template
 * call site lives under the `(dashboard)` route group, whose layout
 * already redirects any Portal-only identity to `/portal` before any of
 * this module's code is ever called.
 */
export class QuoteTemplateAccessError extends Error {
  constructor() {
    super("Quote Templates can only be managed by organization owners and admins.");
    this.name = "QuoteTemplateAccessError";
  }
}

export async function canManageQuoteTemplates(organizationId: string, role: Role): Promise<boolean> {
  return getEffectivePermission({ organizationId, role, permissionKey: "QUOTE_TEMPLATES_MANAGE" });
}

/** Throws `QuoteTemplateAccessError` when the effective QUOTE_TEMPLATES_MANAGE permission is denied — every management entry point (create/update/archive/restore/duplicate) calls this first, before any DB read, so no query below it ever runs for an unauthorized caller. */
export async function assertCanManageQuoteTemplates(organizationId: string, role: Role): Promise<void> {
  if (!(await canManageQuoteTemplates(organizationId, role))) {
    throw new QuoteTemplateAccessError();
  }
}

/**
 * Applying an ACTIVE template is exactly as permissive as creating an
 * ordinary Quote — currently every Staff role, unconditionally, and NOT
 * part of the Roles / Permissions V1 catalog (locked spec §9). Returns
 * `true` unconditionally today (unchanged from before this feature);
 * never used to gate management actions, and never a substitute for
 * assertCanManageQuoteTemplates().
 */
export function canApplyQuoteTemplates(role: Role): boolean {
  // `role` is intentionally not branched on today (see this function's
  // own doc comment) -- the reference below keeps the parameter a real,
  // checked part of this function's signature (for the day Quote-create
  // permissions genuinely differ by role) rather than a vestigial unused
  // one.
  return role != null;
}
