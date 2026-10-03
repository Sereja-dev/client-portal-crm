import { describe, expect, it, vi } from "vitest";

// src/lib/quotes/pdf/view-model.ts imports the real "server-only" marker
// package — see test/unit/invoice-pdf-view-model.test.ts's own identical
// precedent.
vi.mock("server-only", () => ({}));

import { buildQuotePdfViewModel, type QuotePdfBuildInput } from "@/lib/quotes/pdf/view-model";
import { buildInvoiceTotalsViewModel } from "@/lib/invoices/totals-view-model";

/**
 * Quote PDF view-model — canonical-money-reuse proof. buildQuotePdfViewModel()
 * must never compute a total independently; every assertion below
 * cross-checks its output directly against buildInvoiceTotalsViewModel()
 * called with the identical persisted-style input — the exact same
 * function QuoteReadOnlyView itself calls — so a Quote PDF's total can
 * never disagree with the Quote detail page's own total for the same
 * current state.
 */

const issuer = {
  legalName: "Acme Co",
  address: { streetAddress: "1 Main St", city: "Springfield", state: "IL", postalCode: "62701" },
  country: "US",
  taxId: null,
  supportEmail: null,
  phone: null,
  website: null,
  logoImage: null,
};

const recipient = { name: "Jane Client", type: "CLIENT" as const, email: "jane@example.com" };

function baseInput(overrides: Partial<QuotePdfBuildInput> = {}): QuotePdfBuildInput {
  return {
    quoteNumber: "Q-0001",
    statusLabel: "Sent",
    title: null,
    currency: "USD",
    issueDate: new Date("2026-08-17T00:00:00.000Z"),
    validUntil: null,
    lineItems: [{ description: "Design", quantity: "2", unitPrice: "50.00", lineTotal: "100.00" }],
    subtotal: "100.00",
    discountType: "NONE",
    discountAmount: "0.00",
    discountValue: null,
    taxRatePercent: null,
    taxAmount: "0.00",
    taxLabel: "TAX",
    total: "100.00",
    notes: null,
    issuer,
    recipient,
    ...overrides,
  };
}

describe("buildQuotePdfViewModel — canonical totals reuse", () => {
  it("matches buildInvoiceTotalsViewModel() exactly for a zero-discount/zero-tax quote", () => {
    const input = baseInput();
    const result = buildQuotePdfViewModel(input);
    const expected = buildInvoiceTotalsViewModel({
      amount: input.total,
      subtotal: input.subtotal,
      discountType: input.discountType,
      discountAmount: input.discountAmount,
      discountValue: input.discountValue,
      taxRatePercent: input.taxRatePercent,
      taxAmount: input.taxAmount,
      taxLabel: input.taxLabel,
      currency: input.currency,
    });
    expect(result.totals).toEqual(expected);
    expect(result.totals.discountRow).toBeNull();
    expect(result.totals.taxRow).toBeNull();
    expect(result.totals.total).toBe("$100.00");
  });

  it("matches buildInvoiceTotalsViewModel() exactly with discount + tax present", () => {
    const input = baseInput({
      subtotal: "500.00",
      discountType: "PERCENTAGE",
      discountAmount: "50.00",
      discountValue: "10",
      taxRatePercent: "20",
      taxAmount: "90.00",
      taxLabel: "VAT",
      total: "540.00",
    });
    const result = buildQuotePdfViewModel(input);
    const expected = buildInvoiceTotalsViewModel({
      amount: input.total,
      subtotal: input.subtotal,
      discountType: input.discountType,
      discountAmount: input.discountAmount,
      discountValue: input.discountValue,
      taxRatePercent: input.taxRatePercent,
      taxAmount: input.taxAmount,
      taxLabel: input.taxLabel,
      currency: input.currency,
    });
    expect(result.totals).toEqual(expected);
    expect(result.totals.discountRow).toEqual({ label: "Discount (10%)", amount: "$50.00" });
    expect(result.totals.taxRow).toEqual({ label: "VAT (20%)", amount: "$90.00" });
    expect(result.totals.total).toBe("$540.00");
  });

  it("per-line amounts are formatted from the exact persisted quantity/unitPrice/lineTotal — never recomputed by multiplying a second time", () => {
    const input = baseInput({
      lineItems: [
        { description: "Design", quantity: "2.5", unitPrice: "40.00", lineTotal: "100.00" },
        { description: "Hosting", quantity: "1", unitPrice: "29.99", lineTotal: "29.99" },
      ],
    });
    const result = buildQuotePdfViewModel(input);
    expect(result.lineItems).toEqual([
      { description: "Design", quantity: "2.5", unitPrice: "$40.00", lineTotal: "$100.00" },
      { description: "Hosting", quantity: "1", unitPrice: "$29.99", lineTotal: "$29.99" },
    ]);
  });

  it("a non-USD currency formats without a dollar sign", () => {
    const result = buildQuotePdfViewModel(baseInput({ currency: "AED" }));
    expect(result.totals.total).not.toContain("$");
  });
});

describe("buildQuotePdfViewModel — display fields", () => {
  it("passes quoteNumber/statusLabel/title/notes through unchanged", () => {
    const result = buildQuotePdfViewModel(baseInput({ quoteNumber: "Q-0099", statusLabel: "Approved", title: "Website redesign", notes: "Thanks!" }));
    expect(result.quoteNumber).toBe("Q-0099");
    expect(result.statusLabel).toBe("Approved");
    expect(result.title).toBe("Website redesign");
    expect(result.notes).toBe("Thanks!");
  });

  it("a null validUntil renders as null (the document component displays an em dash itself)", () => {
    const result = buildQuotePdfViewModel(baseInput({ validUntil: null }));
    expect(result.validUntilDisplay).toBeNull();
  });

  it("a present validUntil is formatted with the explicit en-US locale, regardless of this runtime's own default", () => {
    const result = buildQuotePdfViewModel(baseInput({ validUntil: new Date("2026-09-01T00:00:00.000Z") }));
    expect(result.validUntilDisplay).toBe("9/1/2026");
  });

  it("issuer and recipient presentations pass through unchanged — this view-model never mutates them", () => {
    const result = buildQuotePdfViewModel(baseInput());
    expect(result.issuer).toEqual(issuer);
    expect(result.recipient).toEqual(recipient);
  });
});
