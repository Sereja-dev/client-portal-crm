import { describe, expect, it } from "vitest";
import { buildQuotePreviewTotals } from "@/lib/quotes/quote-preview-view-model";
import { buildInvoicePreviewTotals } from "@/lib/invoices/invoice-preview-view-model";
import { calculateQuoteTotals } from "@/lib/quotes/calculations";
import { buildInvoiceTotalsViewModel } from "@/lib/invoices/totals-view-model";
import { formatInvoiceCurrencyAmount } from "@/lib/invoices/currencies";

/**
 * Forms Improvement Slice B2 — proves buildQuotePreviewTotals() is a thin,
 * non-forking delegation to Invoice's own buildInvoicePreviewTotals()
 * (itself already proven, by invoice-preview-view-model.test.ts, to be a
 * pure reshaping of calculateInvoiceTotals() + buildInvoiceTotalsViewModel(),
 * the exact same canonical stack the Quote Server Actions and the Quote
 * PDF/detail view already share via calculateQuoteTotals's own re-export).
 * Never a second money-math implementation for Quote.
 */

describe("buildQuotePreviewTotals — delegates entirely to buildInvoicePreviewTotals, never forks it", () => {
  it("returns byte-identical output to buildInvoicePreviewTotals() for the exact same input", () => {
    const input = {
      subtotalSource: { mode: "lineItems" as const, lineItems: [{ description: "Design", quantity: "2.5", unitPrice: "40.00" }] },
      discount: { type: "PERCENTAGE" as const, value: "10" },
      taxRatePercent: "8.25",
      currency: "USD",
      taxLabel: "VAT",
    };
    expect(buildQuotePreviewTotals(input)).toEqual(buildInvoicePreviewTotals(input));
  });

  it("matches calculateQuoteTotals()/buildInvoiceTotalsViewModel() exactly for a multi-line itemized quote with decimal quantities", () => {
    const lineItems = [
      { description: "Design", quantity: "2.5", unitPrice: "40.00" },
      { description: "Hosting", quantity: "1", unitPrice: "29.99" },
    ];
    const discount = { type: "PERCENTAGE" as const, value: "10" };
    const taxRatePercent = "8.25";
    const currency = "USD";
    const taxLabel = "VAT";

    const input = { subtotalSource: { mode: "lineItems" as const, lineItems }, discount, taxRatePercent };
    const rawResult = calculateQuoteTotals(input);
    expect(rawResult.ok).toBe(true);
    if (!rawResult.ok) return;

    const expectedTotals = buildInvoiceTotalsViewModel({
      amount: rawResult.total,
      subtotal: rawResult.subtotal,
      discountType: "PERCENTAGE",
      discountAmount: rawResult.discountAmount,
      discountValue: discount.value,
      taxRatePercent,
      taxAmount: rawResult.taxAmount,
      taxLabel,
      currency,
    });

    const preview = buildQuotePreviewTotals({ ...input, currency, taxLabel });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.totals).toEqual(expectedTotals);

    // Per-line totals come straight from calculateQuoteTotals()'s own
    // CalculatedLineItem rows (just currency-formatted for display) —
    // never recomputed by multiplying qty*price a second time in this
    // adapter.
    expect(preview.lineItems).toHaveLength(2);
    expect(preview.lineItems[0].lineTotal).toBe(formatInvoiceCurrencyAmount(rawResult.lineItems[0].lineTotal, currency));
    expect(preview.lineItems[1].lineTotal).toBe(formatInvoiceCurrencyAmount(rawResult.lineItems[1].lineTotal, currency));
  });

  it("FIXED discount: discountRow present with the canonical label/amount", () => {
    const input = {
      subtotalSource: { mode: "lineItems" as const, lineItems: [{ description: "Service", quantity: "1", unitPrice: "500.00" }] },
      discount: { type: "FIXED" as const, value: "50.00" },
      taxRatePercent: null,
      currency: "USD",
      taxLabel: "TAX",
    };
    const preview = buildQuotePreviewTotals(input);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.totals.discountRow).toEqual({ label: "Discount", amount: "$50.00" });
    expect(preview.totals.taxRow).toBeNull();
    expect(preview.totals.total).toBe("$450.00");
  });

  it("PERCENTAGE discount plus tax: both rows present with the canonical labels/amounts", () => {
    const input = {
      subtotalSource: { mode: "lineItems" as const, lineItems: [{ description: "Service", quantity: "1", unitPrice: "500.00" }] },
      discount: { type: "PERCENTAGE" as const, value: "10" },
      taxRatePercent: "20",
      currency: "USD",
      taxLabel: "GST",
    };
    const preview = buildQuotePreviewTotals(input);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.totals.discountRow).toEqual({ label: "Discount (10%)", amount: "$50.00" });
    expect(preview.totals.taxRow).toEqual({ label: "GST (20%)", amount: "$90.00" }); // (500-50)*0.20
    expect(preview.totals.total).toBe("$540.00");
  });

  it("no discount, no tax: discountRow/taxRow both null, total equals subtotal — zero is a valid, non-error result", () => {
    const input = {
      subtotalSource: { mode: "lineItems" as const, lineItems: [{ description: "Service", quantity: "1", unitPrice: "250.00" }] },
      discount: { type: "NONE" as const },
      taxRatePercent: null,
      currency: "USD",
      taxLabel: "TAX",
    };
    const preview = buildQuotePreviewTotals(input);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.totals.discountRow).toBeNull();
    expect(preview.totals.taxRow).toBeNull();
    expect(preview.totals.total).toBe(preview.totals.displayedSubtotal);
    expect(preview.totals.total).toBe("$250.00");
  });

  it("currency formatting is delegated entirely to formatInvoiceCurrencyAmount — a non-USD currency renders its own symbol/format", () => {
    const preview = buildQuotePreviewTotals({
      subtotalSource: { mode: "lineItems", lineItems: [{ description: "Service", quantity: "1", unitPrice: "1000.00" }] },
      discount: { type: "NONE" },
      taxRatePercent: null,
      currency: "AED",
      taxLabel: "TAX",
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.totals.total).not.toContain("$");
  });
});

describe("buildQuotePreviewTotals — invalid/partial input never throws, never fabricates a total", () => {
  it("empty line items -> { ok: false }", () => {
    const preview = buildQuotePreviewTotals({
      subtotalSource: { mode: "lineItems", lineItems: [] },
      discount: { type: "NONE" },
      taxRatePercent: null,
      currency: "USD",
      taxLabel: "TAX",
    });
    expect(preview).toEqual({ ok: false });
  });

  it("a blank starting line item (zero/empty quantity) -> { ok: false }, not a thrown error", () => {
    const makePreview = () =>
      buildQuotePreviewTotals({
        subtotalSource: { mode: "lineItems", lineItems: [{ description: "", quantity: "", unitPrice: "" }] },
        discount: { type: "NONE" },
        taxRatePercent: null,
        currency: "USD",
        taxLabel: "TAX",
      });
    expect(makePreview).not.toThrow();
    expect(makePreview()).toEqual({ ok: false });
  });

  it("discount exceeding subtotal -> { ok: false }, never a negative total", () => {
    const preview = buildQuotePreviewTotals({
      subtotalSource: { mode: "lineItems", lineItems: [{ description: "Service", quantity: "1", unitPrice: "10.00" }] },
      discount: { type: "FIXED", value: "20.00" },
      taxRatePercent: null,
      currency: "USD",
      taxLabel: "TAX",
    });
    expect(preview).toEqual({ ok: false });
  });
});
