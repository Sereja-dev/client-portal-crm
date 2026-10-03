import type { Role } from "@/generated/prisma/enums";
import { getEffectivePermission } from "@/lib/permissions/resolver";

export type InvoiceTemplateActor = { id: string; name: string; role: Role };

/**
 * Invoice Templates V1 — mirrors src/lib/quote-templates/authorization.ts's
 * own INVOICE_TEMPLATES_MANAGE-catalog-key split exactly (see the
 * completed Invoice Templates readiness audit's own §J finding). Governs
 * management (create/edit/archive/restore/duplicate) ONLY — APPLICATION
 * (canApplyInvoiceTemplates below, using an ACTIVE template to prefill a
 * new Invoice) is untouched, unconditionally open to any Staff role
 * already permitted to create an Invoice (matching Invoice's own "any
 * org member" create permission, confirmed by the Finance Document
 * Actions audit). With zero overrides this reproduces OWNER/ADMIN-only
 * management, identical to QUOTE_TEMPLATES_MANAGE's own default.
 *
 * MEMBER is denied by default for management only. Client Portal
 * identities never reach either function at all — every Invoice Template
 * call site lives under the `(dashboard)` route group, whose layout
 * already redirects any Portal-only identity to `/portal` before any of
 * this module's code is ever called.
 */
export class InvoiceTemplateAccessError extends Error {
  constructor() {
    super("Invoice Templates can only be managed by organization owners and admins.");
    this.name = "InvoiceTemplateAccessError";
  }
}

export async function canManageInvoiceTemplates(organizationId: string, role: Role): Promise<boolean> {
  return getEffectivePermission({ organizationId, role, permissionKey: "INVOICE_TEMPLATES_MANAGE" });
}

/** Throws `InvoiceTemplateAccessError` when the effective INVOICE_TEMPLATES_MANAGE permission is denied — every management entry point (create/update/archive/restore/duplicate) calls this first, before any DB read, so no query below it ever runs for an unauthorized caller. */
export async function assertCanManageInvoiceTemplates(organizationId: string, role: Role): Promise<void> {
  if (!(await canManageInvoiceTemplates(organizationId, role))) {
    throw new InvoiceTemplateAccessError();
  }
}

/**
 * Applying an ACTIVE template is exactly as permissive as creating an
 * ordinary Invoice — currently every Staff role, unconditionally, and NOT
 * part of the Roles / Permissions V1 catalog. Returns `true`
 * unconditionally today; never used to gate management actions, and
 * never a substitute for assertCanManageInvoiceTemplates().
 */
export function canApplyInvoiceTemplates(role: Role): boolean {
  // `role` is intentionally not branched on today (see this function's
  // own doc comment) -- the reference below keeps the parameter a real,
  // checked part of this function's signature (for the day Invoice-create
  // permissions genuinely differ by role) rather than a vestigial unused
  // one.
  return role != null;
}
