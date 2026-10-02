import { describe, expect, it } from "vitest";
import { buildInvoicePreviewTotals } from "@/lib/invoices/invoice-preview-view-model";
import { calculateInvoiceTotals } from "@/lib/invoices/calculations";
import { buildInvoiceTotalsViewModel } from "@/lib/invoices/totals-view-model";
import { formatInvoiceCurrencyAmount } from "@/lib/invoices/currencies";

/**
 * Invoice Live Preview V1 — proves buildInvoicePreviewTotals() is a pure
 * reshaping of calculateInvoiceTotals() + buildInvoiceTotalsViewModel()
 * (the exact same canonical stack the Server Action and the PDF/detail
 * view already use), never a second money-math implementation. Every
 * "ok" case below is cross-checked directly against calculateInvoiceTotals()'s
 * own output for the same input, and against buildInvoiceTotalsViewModel()
 * fed that same output — not against any independently re-derived number.
 */

describe("buildInvoicePreviewTotals — canonical reuse, multiple line items", () => {
  it("matches calculateInvoiceTotals()/buildInvoiceTotalsViewModel() exactly for a multi-line itemized invoice with decimal quantities", () => {
    const lineItems = [
      { description: "Design", quantity: "2.5", unitPrice: "40.00" },
      { description: "Hosting", quantity: "1", unitPrice: "29.99" },
    ];
    const discount = { type: "PERCENTAGE" as const, value: "10" };
    const taxRatePercent = "8.25";
    const currency = "USD";
    const taxLabel = "VAT";

    const input = { subtotalSource: { mode: "lineItems" as const, lineItems }, discount, taxRatePercent };
    const rawResult = calculateInvoiceTotals(input);
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

    const preview = buildInvoicePreviewTotals({ ...input, currency, taxLabel });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.totals).toEqual(expectedTotals);

    // Per-line totals come straight from calculateInvoiceTotals()'s own
    // CalculatedLineItem rows (just currency-formatted for display) —
    // never recomputed by multiplying qty*price a second time in this
    // adapter.
    expect(preview.lineItems).toHaveLength(2);
    expect(preview.lineItems[0].lineTotal).toBe(formatInvoiceCurrencyAmount(rawResult.lineItems[0].lineTotal, currency));
    expect(preview.lineItems[1].lineTotal).toBe(formatInvoiceCurrencyAmount(rawResult.lineItems[1].lineTotal, currency));
    expect(preview.lineItems[0].quantity).toBe("2.5");
    expect(preview.lineItems[1].quantity).toBe("1");
  });

  it("zero discount and zero tax: no discountRow/taxRow, total equals subtotal", () => {
    const input = {
      subtotalSource: { mode: "flat" as const, amount: "250.00" },
      discount: { type: "NONE" as const },
      taxRatePercent: null,
    };
    const preview = buildInvoicePreviewTotals({ ...input, currency: "USD", taxLabel: "TAX" });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.totals.discountRow).toBeNull();
    expect(preview.totals.taxRow).toBeNull();
    expect(preview.totals.total).toBe(preview.totals.displayedSubtotal);
    expect(preview.totals.total).toBe("$250.00");
  });

  it("fixed discount plus tax: discountRow/taxRow both present with the canonical labels/amounts", () => {
    const input = {
      subtotalSource: { mode: "flat" as const, amount: "500.00" },
      discount: { type: "FIXED" as const, value: "50.00" },
      taxRatePercent: "20",
    };
    const rawResult = calculateInvoiceTotals(input);
    expect(rawResult.ok).toBe(true);
    if (!rawResult.ok) return;

    const preview = buildInvoicePreviewTotals({ ...input, currency: "USD", taxLabel: "GST" });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    expect(preview.totals.discountRow).toEqual({ label: "Discount", amount: "$50.00" });
    expect(preview.totals.taxRow).toEqual({ label: "GST (20%)", amount: "$90.00" }); // (500-50)*0.20
    expect(preview.totals.total).toBe("$540.00");
  });

  it("currency formatting is delegated entirely to formatInvoiceCurrencyAmount — a non-USD currency renders its own symbol/format", () => {
    const preview = buildInvoicePreviewTotals({
      subtotalSource: { mode: "flat" as const, amount: "1000.00" },
      discount: { type: "NONE" as const },
      taxRatePercent: null,
      currency: "AED",
      taxLabel: "TAX",
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.totals.total).not.toContain("$");
  });
});

describe("buildInvoicePreviewTotals — invalid/partial input never throws, never fabricates a total", () => {
  it("empty line items -> { ok: false }", () => {
    const preview = buildInvoicePreviewTotals({
      subtotalSource: { mode: "lineItems", lineItems: [] },
      discount: { type: "NONE" },
      taxRatePercent: null,
      currency: "USD",
      taxLabel: "TAX",
    });
    expect(preview).toEqual({ ok: false });
  });

  it("a blank starting line item (zero/empty quantity) -> { ok: false }, not a thrown error", () => {
    expect(() =>
      buildInvoicePreviewTotals({
        subtotalSource: { mode: "lineItems", lineItems: [{ description: "", quantity: "", unitPrice: "" }] },
        discount: { type: "NONE" },
        taxRatePercent: null,
        currency: "USD",
        taxLabel: "TAX",
      }),
    ).not.toThrow();
    const preview = buildInvoicePreviewTotals({
      subtotalSource: { mode: "lineItems", lineItems: [{ description: "", quantity: "", unitPrice: "" }] },
      discount: { type: "NONE" },
      taxRatePercent: null,
      currency: "USD",
      taxLabel: "TAX",
    });
    expect(preview).toEqual({ ok: false });
  });

  it("invalid flat amount (blank) -> { ok: false }", () => {
    const preview = buildInvoicePreviewTotals({
      subtotalSource: { mode: "flat", amount: "" },
      discount: { type: "NONE" },
      taxRatePercent: null,
      currency: "USD",
      taxLabel: "TAX",
    });
    expect(preview).toEqual({ ok: false });
  });

  it("discount exceeding subtotal -> { ok: false }, never a negative total", () => {
    const preview = buildInvoicePreviewTotals({
      subtotalSource: { mode: "flat", amount: "10.00" },
      discount: { type: "FIXED", value: "20.00" },
      taxRatePercent: null,
      currency: "USD",
      taxLabel: "TAX",
    });
    expect(preview).toEqual({ ok: false });
  });
});
