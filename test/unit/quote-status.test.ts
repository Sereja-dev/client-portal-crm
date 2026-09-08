import { describe, expect, it } from "vitest";
import { QuoteStatus } from "@/generated/prisma/enums";
import { isQuoteExpired, isQuoteConverted, isQuoteEditable, isQuoteApprovable } from "@/lib/quotes/status";

/**
 * Quotes / Estimates Phase 1 — the derived-status helpers
 * (src/lib/quotes/status.ts) are the single source of truth for
 * EXPIRED/CONVERTED semantics; neither is ever a stored QuoteStatus
 * value (see the enum's own test below).
 */

describe("QuoteStatus — canonical stored statuses", () => {
  it("10. are exactly DRAFT, SENT, APPROVED, DECLINED — no EXPIRED, no CONVERTED", () => {
    expect(Object.values(QuoteStatus).sort()).toEqual(["APPROVED", "DECLINED", "DRAFT", "SENT"].sort());
  });
});

describe("isQuoteExpired", () => {
  const now = new Date("2026-06-15T12:00:00Z");
  const future = new Date("2026-07-01T00:00:00Z");
  const past = new Date("2026-01-01T00:00:00Z");

  it("1. a DRAFT Quote is never expired, regardless of validUntil", () => {
    expect(isQuoteExpired({ status: "DRAFT", validUntil: past, now })).toBe(false);
  });

  it("2. a SENT Quote with a future validUntil is not expired", () => {
    expect(isQuoteExpired({ status: "SENT", validUntil: future, now })).toBe(false);
  });

  it("3. a SENT Quote with a past validUntil is expired", () => {
    expect(isQuoteExpired({ status: "SENT", validUntil: past, now })).toBe(true);
  });

  it("4. a SENT Quote with a null validUntil is never expired", () => {
    expect(isQuoteExpired({ status: "SENT", validUntil: null, now })).toBe(false);
  });

  it("5. an APPROVED Quote with a past validUntil is not treated as expired", () => {
    expect(isQuoteExpired({ status: "APPROVED", validUntil: past, now })).toBe(false);
  });

  it("a DECLINED Quote with a past validUntil is not treated as expired (only SENT can be)", () => {
    expect(isQuoteExpired({ status: "DECLINED", validUntil: past, now })).toBe(false);
  });

  it("defaults `now` to the real current time when omitted", () => {
    const farFuture = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365);
    expect(isQuoteExpired({ status: "SENT", validUntil: farFuture })).toBe(false);
    const farPast = new Date(Date.now() - 1000 * 60 * 60 * 24 * 365);
    expect(isQuoteExpired({ status: "SENT", validUntil: farPast })).toBe(true);
  });
});

describe("isQuoteConverted", () => {
  it("6. a non-null convertedInvoiceId means converted", () => {
    expect(isQuoteConverted({ convertedInvoiceId: "11111111-1111-1111-1111-111111111111" })).toBe(true);
  });

  it("7. a null convertedInvoiceId means not converted", () => {
    expect(isQuoteConverted({ convertedInvoiceId: null })).toBe(false);
  });

  it("an undefined convertedInvoiceId also means not converted", () => {
    expect(isQuoteConverted({ convertedInvoiceId: undefined })).toBe(false);
  });
});

describe("isQuoteEditable", () => {
  it("8. an APPROVED Quote is not editable", () => {
    expect(isQuoteEditable("APPROVED")).toBe(false);
  });

  it("9. a DRAFT Quote is editable", () => {
    expect(isQuoteEditable("DRAFT")).toBe(true);
  });

  it("a SENT Quote is editable", () => {
    expect(isQuoteEditable("SENT")).toBe(true);
  });

  it("a DECLINED Quote is editable", () => {
    expect(isQuoteEditable("DECLINED")).toBe(true);
  });

  it("a converted Quote is never editable, even if its stored status is DRAFT/SENT/DECLINED", () => {
    expect(isQuoteEditable("SENT", "11111111-1111-1111-1111-111111111111")).toBe(false);
  });

  it("a non-converted Quote's editability is governed by status alone", () => {
    expect(isQuoteEditable("DRAFT", null)).toBe(true);
    expect(isQuoteEditable("APPROVED", null)).toBe(false);
  });
});

describe("isQuoteApprovable", () => {
  const now = new Date("2026-06-15T12:00:00Z");
  const future = new Date("2026-07-01T00:00:00Z");
  const past = new Date("2026-01-01T00:00:00Z");

  it("a SENT, not-yet-expired Quote is approvable", () => {
    expect(isQuoteApprovable({ status: "SENT", validUntil: future, now })).toBe(true);
    expect(isQuoteApprovable({ status: "SENT", validUntil: null, now })).toBe(true);
  });

  it("a SENT but expired Quote is not approvable", () => {
    expect(isQuoteApprovable({ status: "SENT", validUntil: past, now })).toBe(false);
  });

  it("a DRAFT/APPROVED/DECLINED Quote is never approvable", () => {
    expect(isQuoteApprovable({ status: "DRAFT", validUntil: null, now })).toBe(false);
    expect(isQuoteApprovable({ status: "APPROVED", validUntil: null, now })).toBe(false);
    expect(isQuoteApprovable({ status: "DECLINED", validUntil: null, now })).toBe(false);
  });
});
