import { describe, expect, it } from "vitest";
import {
  composeInvoiceNumberCandidate,
  isValidInvoiceNumberPrefix,
  isValidSequence,
  INVOICE_NUMBER_PREFIX_MAX_LENGTH,
} from "@/lib/recurring-invoices/numbering";

describe("isValidInvoiceNumberPrefix", () => {
  it("accepts a short, trimmed, non-empty prefix", () => {
    expect(isValidInvoiceNumberPrefix("INV-")).toBe(true);
  });
  it("rejects an empty or whitespace-only value", () => {
    expect(isValidInvoiceNumberPrefix("")).toBe(false);
    expect(isValidInvoiceNumberPrefix("   ")).toBe(false);
  });
  it("rejects a non-string value", () => {
    expect(isValidInvoiceNumberPrefix(42)).toBe(false);
    expect(isValidInvoiceNumberPrefix(null)).toBe(false);
  });
  it(`rejects a prefix longer than ${INVOICE_NUMBER_PREFIX_MAX_LENGTH} characters`, () => {
    expect(isValidInvoiceNumberPrefix("A".repeat(INVOICE_NUMBER_PREFIX_MAX_LENGTH + 1))).toBe(false);
    expect(isValidInvoiceNumberPrefix("A".repeat(INVOICE_NUMBER_PREFIX_MAX_LENGTH))).toBe(true);
  });
});

describe("composeInvoiceNumberCandidate", () => {
  it("is plain concatenation — no token language, no zero-padding", () => {
    expect(composeInvoiceNumberCandidate("INV-", 5)).toBe("INV-5");
    expect(composeInvoiceNumberCandidate("INV-", 10)).toBe("INV-10");
    expect(composeInvoiceNumberCandidate("ACME", 1)).toBe("ACME1");
  });
});

describe("isValidSequence", () => {
  it("accepts a positive integer", () => {
    expect(isValidSequence(1)).toBe(true);
    expect(isValidSequence(1000)).toBe(true);
  });
  it("rejects zero, negative, and fractional values", () => {
    expect(isValidSequence(0)).toBe(false);
    expect(isValidSequence(-1)).toBe(false);
    expect(isValidSequence(1.5)).toBe(false);
  });
  it("rejects a value beyond the bounded ceiling", () => {
    expect(isValidSequence(1_000_000_001)).toBe(false);
  });
});
