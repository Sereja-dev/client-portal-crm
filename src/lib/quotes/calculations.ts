/**
 * Quotes / Estimates Phase 1 — a thin, non-forking wrapper over the
 * existing Invoice calculation engine (src/lib/invoices/calculations.ts).
 *
 * That module was inspected directly for this phase and confirmed to be
 * genuinely domain-neutral: no Invoice import, no Prisma Client instance,
 * no reference to `Invoice`/`invoiceNumber`/anything Invoice-specific
 * anywhere in its own implementation — it is pure Decimal subtotal/
 * discount/tax/total arithmetic over a caller-supplied line-item or flat-
 * amount source. Per this phase's own explicit instruction ("Do NOT copy/
 * fork the algorithm... strong preference: minimal change"), this module
 * re-exports it unchanged under Quote-domain-friendly names rather than
 * duplicating a single line of its logic. Quote totals therefore use
 * exactly the same Decimal(10,2)/Decimal(10,3) precision, ROUND_HALF_UP
 * rounding, discount-before-tax ordering, and validation rules Invoice
 * already does — proven equal by test/unit/quotes/calculations.test.ts,
 * not merely asserted here.
 */
export {
  calculateInvoiceTotals as calculateQuoteTotals,
  MAX_LINE_ITEMS as MAX_QUOTE_LINE_ITEMS,
  MAX_DESCRIPTION_LENGTH as MAX_QUOTE_DESCRIPTION_LENGTH,
} from "@/lib/invoices/calculations";

export type {
  DecimalInput as QuoteDecimalInput,
  LineItemInput as QuoteLineItemInput,
  SubtotalSource as QuoteSubtotalSource,
  DiscountInput as QuoteDiscountInput,
  InvoiceCalculationInput as QuoteCalculationInput,
  CalculatedLineItem as CalculatedQuoteLineItem,
  InvoiceCalculationError as QuoteCalculationError,
  InvoiceCalculationResult as QuoteCalculationResult,
} from "@/lib/invoices/calculations";
