import { describe, expect, it } from "vitest";
import { buildDuplicateQuoteDefaults, type DuplicateSourceQuoteData } from "@/lib/quotes/duplicate";

describe("buildDuplicateQuoteDefaults", () => {
  const today = new Date("2026-08-17T12:00:00.000Z");
  const suggestedNumber = "Q-0042";

  function baseSource(overrides: Partial<DuplicateSourceQuoteData> = {}): DuplicateSourceQuoteData {
    return {
      leadId: null,
      clientId: "22222222-2222-4222-8222-222222222222",
      title: null,
      currency: "USD",
      notes: null,
      discountType: "NONE",
      discountValue: null,
      taxRatePercent: null,
      taxLabel: "TAX",
      items: [],
      ...overrides,
    };
  }

  it("number is always the caller-supplied suggestion — never derived from the source's own number", () => {
    const result = buildDuplicateQuoteDefaults(baseSource(), suggestedNumber, today);
    expect(result.number).toBe("Q-0042");
  });

  it("a Client-target source: targetType client, clientId copied, leadId undefined", () => {
    const result = buildDuplicateQuoteDefaults(
      baseSource({ clientId: "33333333-3333-4333-8333-333333333333", leadId: null }),
      suggestedNumber,
      today,
    );
    expect(result.targetType).toBe("client");
    expect(result.clientId).toBe("33333333-3333-4333-8333-333333333333");
    expect(result.leadId).toBeUndefined();
  });

  it("a Lead-target source: targetType lead, leadId copied, clientId undefined", () => {
    const result = buildDuplicateQuoteDefaults(
      baseSource({ leadId: "44444444-4444-4444-8444-444444444444", clientId: null }),
      suggestedNumber,
      today,
    );
    expect(result.targetType).toBe("lead");
    expect(result.leadId).toBe("44444444-4444-4444-8444-444444444444");
    expect(result.clientId).toBeUndefined();
  });

  it("a reconciled source (both leadId and clientId set): targetType defaults to lead — never silently drops Lead lineage, matching the edit page's own rule", () => {
    const result = buildDuplicateQuoteDefaults(
      baseSource({ leadId: "44444444-4444-4444-8444-444444444444", clientId: "33333333-3333-4333-8333-333333333333" }),
      suggestedNumber,
      today,
    );
    expect(result.targetType).toBe("lead");
    expect(result.leadId).toBe("44444444-4444-4444-8444-444444444444");
  });

  it("issueDate is formatDateOnly(today) for the exact injected Date, regardless of the source's own issue date", () => {
    const result = buildDuplicateQuoteDefaults(baseSource(), suggestedNumber, today);
    expect(result.issueDate).toBe("2026-08-17");
  });

  it("a different injected today produces a different issueDate — proving no internal new Date() call", () => {
    const other = new Date("2020-01-01T00:00:00.000Z");
    const result = buildDuplicateQuoteDefaults(baseSource(), suggestedNumber, other);
    expect(result.issueDate).toBe("2020-01-01");
  });

  it("validUntil always resets blank — matching the ordinary new-Quote page's own default (no validity policy invented here)", () => {
    const result = buildDuplicateQuoteDefaults(baseSource(), suggestedNumber, today);
    expect(result.validUntil).toBeUndefined();
  });

  it("title null becomes undefined", () => {
    const result = buildDuplicateQuoteDefaults(baseSource({ title: null }), suggestedNumber, today);
    expect(result.title).toBeUndefined();
  });

  it("title present is copied unchanged", () => {
    const result = buildDuplicateQuoteDefaults(baseSource({ title: "Website redesign" }), suggestedNumber, today);
    expect(result.title).toBe("Website redesign");
  });

  it("notes null becomes undefined", () => {
    const result = buildDuplicateQuoteDefaults(baseSource({ notes: null }), suggestedNumber, today);
    expect(result.notes).toBeUndefined();
  });

  it("notes present is copied unchanged", () => {
    const result = buildDuplicateQuoteDefaults(baseSource({ notes: "Client-visible note" }), suggestedNumber, today);
    expect(result.notes).toBe("Client-visible note");
  });

  it("discountValue null becomes undefined", () => {
    const result = buildDuplicateQuoteDefaults(
      baseSource({ discountType: "PERCENTAGE", discountValue: null }),
      suggestedNumber,
      today,
    );
    expect(result.discountValue).toBeUndefined();
  });

  it("discountValue present is copied unchanged", () => {
    const result = buildDuplicateQuoteDefaults(
      baseSource({ discountType: "PERCENTAGE", discountValue: "10" }),
      suggestedNumber,
      today,
    );
    expect(result.discountValue).toBe("10");
    expect(result.discountType).toBe("PERCENTAGE");
  });

  it("taxRatePercent and taxLabel are copied unchanged", () => {
    const result = buildDuplicateQuoteDefaults(
      baseSource({ taxRatePercent: "8.25", taxLabel: "VAT" }),
      suggestedNumber,
      today,
    );
    expect(result.taxRatePercent).toBe("8.25");
    expect(result.taxLabel).toBe("VAT");
  });

  it("currency is passed through unchanged — never replaced by a company/organization default", () => {
    const result = buildDuplicateQuoteDefaults(baseSource({ currency: "EUR" }), suggestedNumber, today);
    expect(result.currency).toBe("EUR");
  });

  it("items are copied by value, ordered, each containing only description/quantity/unitPrice", () => {
    const items = [
      { description: "Design", quantity: "2", unitPrice: "50.00" },
      { description: "Hosting", quantity: "1", unitPrice: "29.99" },
    ];
    const result = buildDuplicateQuoteDefaults(baseSource({ items }), suggestedNumber, today);
    expect(result.items).toEqual(items);
    expect(Object.keys(result.items[0]).sort()).toEqual(["description", "quantity", "unitPrice"].sort());
  });

  it("an empty items array is passed through unchanged — this mapper never fabricates a blank line item (QuoteForm's own state handles that)", () => {
    const result = buildDuplicateQuoteDefaults(baseSource({ items: [] }), suggestedNumber, today);
    expect(result.items).toEqual([]);
  });
});
