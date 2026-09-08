import { describe, expect, it } from "vitest";
import { deriveQuoteStatusDisplay } from "@/components/quotes/quote-status-badge";

const PAST = new Date("2020-01-01T00:00:00.000Z");
const FUTURE = new Date("2099-12-31T00:00:00.000Z");

/**
 * Aqenra Quotes Phase 3 (Staff UI) §N — deriveQuoteStatusDisplay is the
 * single source of truth for a Quote's own displayed status; these tests
 * pin its precedence (CONVERTED > EXPIRED > stored status) directly,
 * rather than only indirectly through a rendered component.
 */
describe("deriveQuoteStatusDisplay — precedence (§N)", () => {
  it("1. DRAFT renders as Draft", () => {
    expect(deriveQuoteStatusDisplay({ status: "DRAFT", validUntil: null, convertedInvoiceId: null })).toEqual({
      key: "DRAFT",
      label: "Draft",
    });
  });

  it("2. SENT, not yet expired, renders as Sent", () => {
    expect(deriveQuoteStatusDisplay({ status: "SENT", validUntil: FUTURE, convertedInvoiceId: null })).toEqual({
      key: "SENT",
      label: "Sent",
    });
  });

  it("3. APPROVED renders as Approved", () => {
    expect(deriveQuoteStatusDisplay({ status: "APPROVED", validUntil: null, convertedInvoiceId: null })).toEqual({
      key: "APPROVED",
      label: "Approved",
    });
  });

  it("4. DECLINED renders as Declined", () => {
    expect(deriveQuoteStatusDisplay({ status: "DECLINED", validUntil: null, convertedInvoiceId: null })).toEqual({
      key: "DECLINED",
      label: "Declined",
    });
  });

  it("5. SENT with a past validUntil renders as the derived Expired state, not Sent", () => {
    expect(deriveQuoteStatusDisplay({ status: "SENT", validUntil: PAST, convertedInvoiceId: null })).toEqual({
      key: "EXPIRED",
      label: "Expired",
    });
  });

  it("SENT with validUntil null never renders as Expired (no expiry was ever set)", () => {
    expect(deriveQuoteStatusDisplay({ status: "SENT", validUntil: null, convertedInvoiceId: null })).toEqual({
      key: "SENT",
      label: "Sent",
    });
  });

  it("DRAFT with a past validUntil (never actually sent) never renders as Expired", () => {
    expect(deriveQuoteStatusDisplay({ status: "DRAFT", validUntil: PAST, convertedInvoiceId: null })).toEqual({
      key: "DRAFT",
      label: "Draft",
    });
  });

  it("6. a converted Quote renders as Converted regardless of its own stored status", () => {
    for (const status of ["DRAFT", "SENT", "APPROVED", "DECLINED"] as const) {
      expect(deriveQuoteStatusDisplay({ status, validUntil: null, convertedInvoiceId: "inv-1" })).toEqual({
        key: "CONVERTED",
        label: "Converted",
      });
    }
  });

  it("CONVERTED outranks EXPIRED — a converted, formerly-SENT quote whose validUntil has long since passed still shows Converted, never Expired", () => {
    expect(deriveQuoteStatusDisplay({ status: "SENT", validUntil: PAST, convertedInvoiceId: "inv-1" })).toEqual({
      key: "CONVERTED",
      label: "Converted",
    });
  });
});
