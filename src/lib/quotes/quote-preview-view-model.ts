import {
  buildInvoicePreviewTotals,
  type InvoicePreviewInput,
  type InvoicePreviewLineItem,
  type InvoicePreviewTotals,
} from "@/lib/invoices/invoice-preview-view-model";

export type QuotePreviewLineItem = InvoicePreviewLineItem;
export type QuotePreviewTotals = InvoicePreviewTotals;
export type QuotePreviewInput = InvoicePreviewInput;

/**
 * Quote Live Preview — a thin, non-forking wrapper over the existing
 * Invoice Live Preview adapter (src/lib/invoices/invoice-preview-view-model.ts),
 * matching the exact same "re-export, don't fork" choice
 * src/lib/quotes/calculations.ts already made for calculateQuoteTotals
 * itself. buildInvoicePreviewTotals() is already fully domain-neutral —
 * its only inputs are a subtotal source, a discount, a tax rate, a
 * currency, and a tax label, none of which are Invoice-specific — so
 * this module introduces no new money math, no new rounding, and no
 * second totals implementation. It exists only so Quote call sites read
 * `buildQuotePreviewTotals`/`QuotePreviewInput`/`QuotePreviewTotals`
 * rather than borrowing Invoice-named symbols directly, the same
 * Quote-domain-friendly-naming courtesy `calculateQuoteTotals` already
 * extends.
 */
export function buildQuotePreviewTotals(input: QuotePreviewInput): QuotePreviewTotals {
  return buildInvoicePreviewTotals(input);
}
