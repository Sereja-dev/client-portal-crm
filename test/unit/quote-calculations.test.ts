import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { calculateInvoiceTotals } from "@/lib/invoices/calculations";
import { calculateQuoteTotals } from "@/lib/quotes/calculations";

/**
 * Quotes / Estimates Phase 1 — proves calculateQuoteTotals is byte-for-
 * byte the same function as calculateInvoiceTotals (a thin re-export, not
 * a fork — see src/lib/quotes/calculations.ts's own header comment), and
 * that Quote totals therefore share Invoice's exact Decimal precision,
 * rounding, discount-before-tax ordering, and validation behavior.
 */

function dec(value: string): string {
  return new Prisma.Decimal(value).toString();
}

describe("calculateQuoteTotals — identity with calculateInvoiceTotals", () => {
  it("is the exact same function reference, not a separate implementation", () => {
    expect(calculateQuoteTotals).toBe(calculateInvoiceTotals);
  });
});

describe("calculateQuoteTotals — Invoice semantics preserved", () => {
  it("11. matches Invoice's own worked example (line items, discount %, tax %)", () => {
    const input = {
      subtotalSource: {
        mode: "lineItems" as const,
        lineItems: [
          { description: "Design work", quantity: "10.5", unitPrice: "85.00" },
          { description: "Hosting", quantity: "1", unitPrice: "29.99" },
        ],
      },
      discount: { type: "PERCENTAGE" as const, value: "10" },
      taxRatePercent: "8.25",
    };

    const quoteResult = calculateQuoteTotals(input);
    const invoiceResult = calculateInvoiceTotals(input);

    expect(quoteResult.ok).toBe(true);
    expect(invoiceResult.ok).toBe(true);
    if (!quoteResult.ok || !invoiceResult.ok) return;

    expect(quoteResult.subtotal.toString()).toBe(invoiceResult.subtotal.toString());
    expect(quoteResult.discountAmount.toString()).toBe(invoiceResult.discountAmount.toString());
    expect(quoteResult.taxAmount.toString()).toBe(invoiceResult.taxAmount.toString());
    expect(quoteResult.total.toString()).toBe(invoiceResult.total.toString());
    expect(quoteResult.total.toString()).toBe(dec("898.73"));
  });

  it("12. rounding matches — ROUND_HALF_UP, 67.00 subtotal at 1.5% tax → 1.01, not 1.00", () => {
    const result = calculateQuoteTotals({
      subtotalSource: { mode: "flat", amount: "67.00" },
      discount: { type: "NONE" },
      taxRatePercent: "1.5",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.taxAmount.toString()).toBe(dec("1.01"));
    expect(result.total.toString()).toBe(dec("68.01"));
  });

  it("13. discount is computed on subtotal, tax is computed after discount (discount-before-tax ordering)", () => {
    // subtotal 200, 50% discount -> 100 taxable base, 10% tax -> 10, not
    // 20 (which a tax-before-discount ordering would incorrectly produce).
    const result = calculateQuoteTotals({
      subtotalSource: { mode: "flat", amount: "200.00" },
      discount: { type: "PERCENTAGE", value: "50" },
      taxRatePercent: "10",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.discountAmount.toString()).toBe(dec("100.00"));
    expect(result.taxAmount.toString()).toBe(dec("10.00"));
    expect(result.total.toString()).toBe(dec("110.00"));
  });

  it("14. negative/invalid behavior remains consistent with Invoice — a negative flat amount is rejected", () => {
    const result = calculateQuoteTotals({
      subtotalSource: { mode: "flat", amount: "-10.00" },
      discount: { type: "NONE" },
      taxRatePercent: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_FLAT_AMOUNT");
  });

  it("14b. a FIXED discount exceeding the subtotal is rejected, same as Invoice", () => {
    const result = calculateQuoteTotals({
      subtotalSource: { mode: "flat", amount: "50.00" },
      discount: { type: "FIXED", value: "75.00" },
      taxRatePercent: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DISCOUNT_EXCEEDS_SUBTOTAL");
  });

  it("14c. a zero total is legal, same as Invoice (a fully comped quote)", () => {
    const result = calculateQuoteTotals({
      subtotalSource: { mode: "flat", amount: "0.00" },
      discount: { type: "NONE" },
      taxRatePercent: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.total.toString()).toBe(dec("0"));
  });
});
