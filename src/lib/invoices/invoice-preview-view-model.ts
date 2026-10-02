import { Prisma } from "@/generated/prisma/browser";
import { calculateInvoiceTotals, type InvoiceCalculationInput } from "./calculations";
import { buildInvoiceTotalsViewModel, type InvoiceTotalsViewModel } from "./totals-view-model";
import { formatInvoiceCurrencyAmount } from "./currencies";

/**
 * `@/generated/prisma/browser`'s own namespace exports `Decimal` as a
 * value only — see the identical, longer comment in calculations.ts and
 * totals-view-model.ts. `InstanceType<typeof Prisma.Decimal>` recovers
 * the instance type.
 */
type Decimal = InstanceType<typeof Prisma.Decimal>;

export type InvoicePreviewLineItem = {
  description: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
};

export type InvoicePreviewTotals =
  | { ok: true; totals: InvoiceTotalsViewModel; lineItems: InvoicePreviewLineItem[] }
  | { ok: false };

export type InvoicePreviewInput = InvoiceCalculationInput & {
  currency: string;
  taxLabel: string;
};

/**
 * Invoice Live Preview V1 — the ONLY place the live document preview
 * computes anything. This is a thin adapter, not a second money-math
 * implementation: every number is produced by the existing canonical
 * `calculateInvoiceTotals()` (docs/invoicing-architecture.md §5, the same
 * function the Server Action and the old inline total preview both already
 * call) and the existing renderer-agnostic `buildInvoiceTotalsViewModel()`
 * (already shared by `invoice-read-only-view.tsx` and the PDF view-model).
 * This module only reshapes those two existing outputs into display-ready
 * strings for the new `InvoicePreview` component — it introduces no new
 * rounding, no new tax/discount formula, and no manual floating-point sum.
 *
 * Returns `{ ok: false }` for any input `calculateInvoiceTotals()` itself
 * would reject (empty/invalid line items, invalid flat amount, discount/tax
 * out of range, etc.) — the caller renders a truthful "not ready yet"
 * placeholder rather than fabricating a zero or stale total, matching the
 * old inline preview's own established convention.
 */
export function buildInvoicePreviewTotals(input: InvoicePreviewInput): InvoicePreviewTotals {
  const result = calculateInvoiceTotals(input);
  if (!result.ok) return { ok: false };

  const format = (value: Decimal): string => formatInvoiceCurrencyAmount(value, input.currency) ?? value.toString();

  const totals = buildInvoiceTotalsViewModel({
    amount: result.total,
    subtotal: result.subtotal,
    discountType: input.discount.type,
    discountAmount: result.discountAmount,
    discountValue: input.discount.type === "NONE" ? null : input.discount.value,
    taxRatePercent: input.taxRatePercent,
    taxAmount: result.taxAmount,
    taxLabel: input.taxLabel,
    currency: input.currency,
  });

  const lineItems: InvoicePreviewLineItem[] = result.lineItems.map((lineItem) => ({
    description: lineItem.description,
    quantity: lineItem.quantity.toString(),
    unitPrice: format(lineItem.unitPrice),
    lineTotal: format(lineItem.lineTotal),
  }));

  return { ok: true, totals, lineItems };
}
