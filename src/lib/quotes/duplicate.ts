import { formatDateOnly } from "@/lib/invoices/date-only";
import type { InvoiceDiscountTypeValue, InvoiceTaxLabelValue } from "@/lib/validation/invoice";

/**
 * Quote Duplicate-as-new-DRAFT. Pure mapping only: no Prisma import, no
 * current-user/session import, no database access, no `new Date()`
 * internally — `today` is always an explicit, injected parameter (the
 * caller captures it once), matching src/lib/invoices/duplicate.ts's own
 * established determinism discipline exactly. `suggestedNumber` is
 * likewise always an explicit, injected parameter — this module never
 * calls suggestNextQuoteNumber() itself (that function is server-only/
 * Prisma-backed; see its own header comment), it only places the
 * caller-supplied suggestion into the right field.
 *
 * This module never decides currency — its caller passes the source
 * Quote's own already-persisted currency through unchanged (§13 of this
 * slice's own spec: a duplicate must never silently replace it with the
 * organization's current default).
 */

export type DuplicateSourceQuoteLineItem = {
  description: string;
  quantity: string;
  unitPrice: string;
};

export type DuplicateSourceQuoteData = {
  leadId: string | null;
  clientId: string | null;
  title: string | null;
  currency: string;
  notes: string | null;
  discountType: InvoiceDiscountTypeValue;
  discountValue: string | null;
  taxRatePercent: string | null;
  taxLabel: InvoiceTaxLabelValue;
  items: DuplicateSourceQuoteLineItem[];
};

/**
 * Structurally compatible with QuoteForm's own private `QuoteFormDefaults`
 * type (src/components/quotes/quote-form.tsx) — deliberately NOT imported
 * from there, for the identical reason src/lib/invoices/duplicate.ts's own
 * `DuplicateInvoiceDefaults` gives: that type is private to a Client
 * Component, and importing it here would invert the src/lib ->
 * src/components dependency direction. Kept as an independent,
 * field-for-field-identical type instead.
 */
export type DuplicateQuoteDefaults = {
  number: string;
  title?: string;
  targetType: "lead" | "client";
  leadId?: string;
  clientId?: string;
  issueDate: string;
  validUntil?: string;
  currency: string;
  notes?: string;
  discountType: InvoiceDiscountTypeValue;
  discountValue?: string;
  taxRatePercent?: string;
  taxLabel: InvoiceTaxLabelValue;
  items: DuplicateSourceQuoteLineItem[];
};

/**
 * Builds the complete DRAFT-form prefill from a source Quote at any
 * status. Field-level contract (see this slice's own §4):
 *
 *  COPY:   target (lead/client), title, currency, items, discount config,
 *          tax rate/label, customer-facing notes.
 *  RESET:  number (ordinary create-page suggestion, never a "-R1"-style
 *          derivative of the source's own number — Quote numbering has no
 *          such established convention, unlike Invoice's), status (always
 *          DRAFT via the ordinary create action), sentAt/recipient
 *          snapshot, approvedAt/declinedAt, convertedInvoiceId,
 *          archivedAt, every derived converted/expired state, created/
 *          updated metadata, lifecycle history. None of these fields are
 *          even read from the source in the first place (see
 *          duplicate-source.ts's own narrow SELECT) — there is nothing
 *          here that could accidentally carry them forward.
 *
 * `targetType` mirrors the edit page's own existing rule exactly
 * (defaulting to "lead" whenever leadId is set, even if clientId also is
 * — see QuoteFormDefaults's own doc comment): never silently drops Lead
 * lineage.
 *
 * `issueDate` always resets to `today` (never the source's own issue
 * date — this is a new document) and `validUntil` always resets blank,
 * matching the ordinary new-Quote page's own defaults exactly (it sets
 * no default validUntil at all) — not a new validity policy invented
 * here.
 */
export function buildDuplicateQuoteDefaults(
  source: DuplicateSourceQuoteData,
  suggestedNumber: string,
  today: Date,
): DuplicateQuoteDefaults {
  return {
    number: suggestedNumber,
    title: source.title ?? undefined,
    targetType: source.leadId ? "lead" : "client",
    leadId: source.leadId ?? undefined,
    clientId: source.clientId ?? undefined,
    issueDate: formatDateOnly(today),
    validUntil: undefined,
    currency: source.currency,
    notes: source.notes ?? undefined,
    discountType: source.discountType,
    discountValue: source.discountValue ?? undefined,
    taxRatePercent: source.taxRatePercent ?? undefined,
    taxLabel: source.taxLabel,
    items: source.items,
  };
}
