import type { Role } from "@/generated/prisma/enums";
import { getEffectivePermission } from "@/lib/permissions/resolver";

export type ContractTemplateActor = { id: string; name: string; role: Role };

/**
 * Contract Templates V1 — mirrors src/lib/invoice-templates/authorization.ts's
 * own CONTRACT_TEMPLATES_MANAGE-catalog-key split exactly (see the
 * approved Slice B spec's own §7). Governs management (create/edit/
 * archive/restore/duplicate) ONLY — APPLICATION (canApplyContractTemplates
 * below, using an ACTIVE template to prefill a new Contract) is untouched,
 * unconditionally open to any Staff role already permitted to create a
 * Contract (matching Contract's own canManageContracts() — "any role" —
 * confirmed directly from src/lib/contracts/authorization.ts). With zero
 * overrides this reproduces OWNER/ADMIN-only management, identical to
 * QUOTE_TEMPLATES_MANAGE/INVOICE_TEMPLATES_MANAGE's own default.
 *
 * MEMBER is denied by default for management only. Client Portal
 * identities never reach either function at all — every Contract Template
 * call site lives under the `(dashboard)` route group, whose layout
 * already redirects any Portal-only identity to `/portal` before any of
 * this module's code is ever called.
 */
export class ContractTemplateAccessError extends Error {
  constructor() {
    super("Contract Templates can only be managed by organization owners and admins.");
    this.name = "ContractTemplateAccessError";
  }
}

export async function canManageContractTemplates(organizationId: string, role: Role): Promise<boolean> {
  return getEffectivePermission({ organizationId, role, permissionKey: "CONTRACT_TEMPLATES_MANAGE" });
}

/** Throws `ContractTemplateAccessError` when the effective CONTRACT_TEMPLATES_MANAGE permission is denied — every management entry point (create/update/archive/restore/duplicate) calls this first, before any DB read, so no query below it ever runs for an unauthorized caller. */
export async function assertCanManageContractTemplates(organizationId: string, role: Role): Promise<void> {
  if (!(await canManageContractTemplates(organizationId, role))) {
    throw new ContractTemplateAccessError();
  }
}

/**
 * Applying an ACTIVE template is exactly as permissive as creating an
 * ordinary Contract — currently every Staff role, unconditionally
 * (src/lib/contracts/authorization.ts's own canManageContracts(), despite
 * its name, is Contract's own "any role may create/manage" gate — not
 * part of the Roles / Permissions V1 catalog). Returns `true`
 * unconditionally today; never used to gate management actions, and
 * never a substitute for assertCanManageContractTemplates().
 */
export function canApplyContractTemplates(role: Role): boolean {
  // `role` is intentionally not branched on today (see this function's
  // own doc comment) -- the reference below keeps the parameter a real,
  // checked part of this function's signature (for the day Contract-create
  // permissions genuinely differ by role) rather than a vestigial unused
  // one.
  return role != null;
}
