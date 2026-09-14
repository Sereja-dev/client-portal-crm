import "server-only";
import { getCurrentMembership } from "@/lib/current-user";
import { canApplyQuoteTemplates } from "./authorization";
import { getActiveQuoteTemplateForApply } from "./queries";
import { addValidityDays } from "./date";
import { formatDateOnly } from "@/lib/invoices/date-only";
import type { InvoiceDiscountType, InvoiceTaxLabel } from "@/generated/prisma/enums";

/**
 * Quote Templates Phase 1 — the one, read-only apply/prefill entry point.
 * Resolves the current Staff member/organization itself (never accepts
 * organizationId as a parameter), permits any Staff role already allowed
 * to create a Quote (canApplyQuoteTemplates() -- currently every role),
 * rejects a foreign-org id and an archived template identically to
 * "not found" (getActiveQuoteTemplateForApply's own contract), loads
 * items in position order, and returns a plain, already-serializable
 * prefill object.
 *
 * Creates nothing. Mutates nothing. No Quote row, no Activity row, no
 * Workflow Automation event -- this function is a single read query plus
 * pure date arithmetic, nothing else. The future Phase 2 route
 * (`/quotes/new?template=<id>`) will call this and hand the result to the
 * existing, completely unmodified Quote-create form -- exactly the same
 * "read-only prefill, ordinary create action does the real write" shape
 * `/invoices/[id]/duplicate` already proves out in this codebase today.
 *
 * `now` is always caller-supplied (never `new Date()` called internally)
 * so a test can assert the exact resulting `validUntil` deterministically
 * — mirrors every other "one authoritative now" entry point in this app
 * (getDashboardAnalytics, getReportsOverview).
 */

export type QuoteTemplateApplyItem = { description: string; quantity: string; unitPrice: string };

/**
 * Only what a NEW Quote's own create form needs to prefill itself with —
 * deliberately never organizationId, createdByUserId, archivedAt, or any
 * other template-management metadata, and never any Quote-record
 * identity (Client/Lead, Quote number, status, recipient snapshot): none
 * of those can or should come from a template (see QuoteTemplate's own
 * schema comment — Quote Templates V1 are deliberately client-agnostic).
 */
export type QuoteTemplateApplyDefaults = {
  title: string | null;
  notes: string | null;
  currency: string;
  discountType: InvoiceDiscountType;
  discountValue: string | null;
  taxRatePercent: string | null;
  taxLabel: InvoiceTaxLabel;
  items: QuoteTemplateApplyItem[];
  /** "YYYY-MM-DD", matching the same date-only string shape Quote's own create form already expects for validUntil — or null when the template has no validityDays set. Already computed server-side from `now`'s own UTC calendar date; the caller never needs to re-derive it. */
  validUntil: string | null;
};

export type GetQuoteTemplateDefaultsResult = { ok: true; defaults: QuoteTemplateApplyDefaults } | { ok: false; reason: "NOT_FOUND" };

export async function getQuoteTemplateDefaults(templateId: string, now: Date = new Date()): Promise<GetQuoteTemplateDefaultsResult> {
  const { organizationId, membership } = await getCurrentMembership();

  // Documented as always true today (see authorization.ts's own header
  // comment) -- called anyway so a future change to Quote-create
  // permissions is enforced here automatically, without this file
  // needing to change.
  if (!canApplyQuoteTemplates(membership.role)) {
    return { ok: false, reason: "NOT_FOUND" };
  }

  const template = await getActiveQuoteTemplateForApply(organizationId, templateId);
  if (!template) {
    return { ok: false, reason: "NOT_FOUND" };
  }

  const validUntil = template.validityDays != null ? formatDateOnly(addValidityDays(now, template.validityDays)) : null;

  return {
    ok: true,
    defaults: {
      title: template.title,
      notes: template.notes,
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
      validUntil,
    },
  };
}
