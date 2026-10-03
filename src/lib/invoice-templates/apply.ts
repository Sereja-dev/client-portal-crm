import "server-only";
import { getCurrentMembership } from "@/lib/current-user";
import { canApplyInvoiceTemplates } from "./authorization";
import { getActiveInvoiceTemplateForApply } from "./queries";
import { addDueDateOffsetDays } from "./date";
import { formatDateOnly } from "@/lib/invoices/date-only";
import type { InvoiceDiscountType, InvoiceTaxLabel } from "@/generated/prisma/enums";

/**
 * Invoice Templates V1 — the one, read-only apply/prefill entry point.
 * Resolves the current Staff member/organization itself (never accepts
 * organizationId as a parameter), permits any Staff role already allowed
 * to create an Invoice (canApplyInvoiceTemplates() -- currently every
 * role), rejects a foreign-org id and an archived template identically to
 * "not found" (getActiveInvoiceTemplateForApply's own contract), loads
 * items in position order, and returns a plain, already-serializable
 * prefill object.
 *
 * Creates nothing. Mutates nothing. No Invoice row, no InvoiceLineItem
 * row, no Activity row, no Workflow Automation event -- this function is
 * a single read query plus pure date arithmetic, nothing else. The
 * `/invoices/new?templateId=<id>` route calls this and hands the result
 * to the existing, completely unmodified InvoiceForm/createInvoiceAction
 * path -- exactly the same "read-only prefill, ordinary create action
 * does the real write" shape getQuoteTemplateDefaults() already
 * established for Quotes.
 *
 * Deliberately never supplies clientId/projectId -- InvoiceTemplate
 * stores neither (see its own schema doc comment). The caller composes
 * this result with any independently-supplied `?clientId=` itself; this
 * function has no opinion on that composition.
 *
 * `now` is always caller-supplied (never `new Date()` called internally)
 * so a test can assert the exact resulting `dueDate` deterministically —
 * mirrors every other "one authoritative now" entry point in this app
 * (getDashboardAnalytics, getReportsOverview, getQuoteTemplateDefaults).
 */

export type InvoiceTemplateApplyItem = { description: string; quantity: string; unitPrice: string };

/**
 * Only what a NEW Invoice's own create form needs to prefill itself with
 * — deliberately never organizationId, createdByUserId, archivedAt, or
 * any other template-management metadata, and never any Invoice-record
 * identity (Client/Project, invoice number, status, issuer/recipient
 * snapshot): none of those can or should come from a template (see
 * InvoiceTemplate's own schema comment — Invoice Templates V1 are
 * deliberately client/project-agnostic).
 */
export type InvoiceTemplateApplyDefaults = {
  notes: string | null;
  internalNotes: string | null;
  currency: string;
  discountType: InvoiceDiscountType;
  discountValue: string | null;
  taxRatePercent: string | null;
  taxLabel: InvoiceTaxLabel;
  items: InvoiceTemplateApplyItem[];
  /** "YYYY-MM-DD", matching the same date-only string shape Invoice's own create form already expects for dueDate — or null when the template has no dueDateOffsetDays set. Already computed server-side from `now`'s own UTC calendar date; the caller never needs to re-derive it. */
  dueDate: string | null;
};

export type GetInvoiceTemplateDefaultsResult =
  | { ok: true; defaults: InvoiceTemplateApplyDefaults }
  | { ok: false; reason: "NOT_FOUND" };

export async function getInvoiceTemplateDefaults(templateId: string, now: Date = new Date()): Promise<GetInvoiceTemplateDefaultsResult> {
  const { organizationId, membership } = await getCurrentMembership();

  // Documented as always true today (see authorization.ts's own header
  // comment) -- called anyway so a future change to Invoice-create
  // permissions is enforced here automatically, without this file
  // needing to change.
  if (!canApplyInvoiceTemplates(membership.role)) {
    return { ok: false, reason: "NOT_FOUND" };
  }

  const template = await getActiveInvoiceTemplateForApply(organizationId, templateId);
  if (!template) {
    return { ok: false, reason: "NOT_FOUND" };
  }

  const dueDate = template.dueDateOffsetDays != null ? formatDateOnly(addDueDateOffsetDays(now, template.dueDateOffsetDays)) : null;

  return {
    ok: true,
    defaults: {
      notes: template.notes,
      internalNotes: template.internalNotes,
      currency: template.currency,
      discountType: template.discountType,
      discountValue: template.discountValue?.toString() ?? null,
      taxRatePercent: template.taxRatePercent?.toString() ?? null,
      taxLabel: template.taxLabel,
      items: template.items.map((item) => ({
        description: item.description,
        quantity: item.quantity.toString(),
        unitPrice: item.unitPrice.toString(),
      })),
      dueDate,
    },
  };
}
