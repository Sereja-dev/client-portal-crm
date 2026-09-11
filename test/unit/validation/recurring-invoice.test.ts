import { describe, expect, it } from "vitest";
import {
  isValidFrequency,
  isValidAnchorDay,
  parseDueDateOffsetDays,
  parseFirstIssueDate,
  parseRecurringInvoiceTemplateFields,
} from "@/lib/validation/recurring-invoice";

/** Recurring Invoices Phase 1 — field-level validation (test item 9 + the VALIDATION section's own explicit requirements). */

describe("isValidFrequency", () => {
  it("accepts exactly the four documented frequencies", () => {
    expect(isValidFrequency("WEEKLY")).toBe(true);
    expect(isValidFrequency("MONTHLY")).toBe(true);
    expect(isValidFrequency("QUARTERLY")).toBe(true);
    expect(isValidFrequency("YEARLY")).toBe(true);
  });
  it("rejects anything else, including a custom interval", () => {
    expect(isValidFrequency("BIWEEKLY")).toBe(false);
    expect(isValidFrequency("")).toBe(false);
    expect(isValidFrequency(undefined)).toBe(false);
  });
});

describe("isValidAnchorDay", () => {
  it("accepts 1..31", () => {
    expect(isValidAnchorDay(1)).toBe(true);
    expect(isValidAnchorDay(31)).toBe(true);
    expect(isValidAnchorDay(15)).toBe(true);
  });
  it("rejects 0, 32, and a fractional value", () => {
    expect(isValidAnchorDay(0)).toBe(false);
    expect(isValidAnchorDay(32)).toBe(false);
    expect(isValidAnchorDay(15.5)).toBe(false);
  });
});

describe("9. parseFirstIssueDate — malformed dates are rejected", () => {
  it("accepts a well-formed YYYY-MM-DD", () => {
    const result = parseFirstIssueDate("2027-03-15");
    expect(result.ok).toBe(true);
  });
  it("rejects a non-existent calendar date, garbage, and a non-string", () => {
    expect(parseFirstIssueDate("2027-02-30")).toEqual({ ok: false });
    expect(parseFirstIssueDate("not-a-date")).toEqual({ ok: false });
    expect(parseFirstIssueDate(20270315)).toEqual({ ok: false });
    expect(parseFirstIssueDate(undefined)).toEqual({ ok: false });
  });
});

describe("parseDueDateOffsetDays", () => {
  it("null/undefined/empty all mean 'no due date'", () => {
    expect(parseDueDateOffsetDays(undefined)).toEqual({ ok: true, value: null });
    expect(parseDueDateOffsetDays(null)).toEqual({ ok: true, value: null });
    expect(parseDueDateOffsetDays("")).toEqual({ ok: true, value: null });
  });
  it("accepts a non-negative integer within the bounded ceiling", () => {
    expect(parseDueDateOffsetDays(0)).toEqual({ ok: true, value: 0 });
    expect(parseDueDateOffsetDays("30")).toEqual({ ok: true, value: 30 });
  });
  it("rejects a negative value, a fractional value, and a value beyond the ceiling", () => {
    expect(parseDueDateOffsetDays(-1)).toEqual({ ok: false });
    expect(parseDueDateOffsetDays(1.5)).toEqual({ ok: false });
    expect(parseDueDateOffsetDays(400)).toEqual({ ok: false });
  });
});

describe("parseRecurringInvoiceTemplateFields", () => {
  const baseInput = {
    invoiceNumberPrefix: "INV-",
    currency: "USD",
    lineItems: [{ description: "Retainer", quantity: "1", unitPrice: "500.00" }],
  };

  it("accepts a minimal valid template", () => {
    const result = parseRecurringInvoiceTemplateFields(baseInput);
    expect(result.ok).toBe(true);
  });

  it("rejects an empty line-item list", () => {
    const result = parseRecurringInvoiceTemplateFields({ ...baseInput, lineItems: [] });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.fieldErrors.lineItems).toBeDefined();
  });

  it("rejects an unsupported currency", () => {
    const result = parseRecurringInvoiceTemplateFields({ ...baseInput, currency: "XXX" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.fieldErrors.currency).toBeDefined();
  });

  it("rejects an invalid invoiceNumberPrefix", () => {
    const result = parseRecurringInvoiceTemplateFields({ ...baseInput, invoiceNumberPrefix: "" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.fieldErrors.invoiceNumberPrefix).toBeDefined();
  });

  it("rejects an out-of-range startingSequence", () => {
    const result = parseRecurringInvoiceTemplateFields({ ...baseInput, startingSequence: 0 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.fieldErrors.startingSequence).toBeDefined();
  });

  it("defaults startingSequence to 1 when omitted", () => {
    const result = parseRecurringInvoiceTemplateFields(baseInput);
    if (!result.ok) throw new Error("expected ok");
    expect(result.values.startingSequence).toBe(1);
  });

  it("rejects a discount that exceeds the subtotal (reuses calculateInvoiceTotals)", () => {
    const result = parseRecurringInvoiceTemplateFields({
      ...baseInput,
      discountType: "FIXED",
      discountValue: "9999.00",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.fieldErrors.discountValue).toBeDefined();
  });

  it("rejects a tax rate out of the 0-100 range", () => {
    const result = parseRecurringInvoiceTemplateFields({ ...baseInput, taxRatePercent: "150" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.fieldErrors.taxRatePercent).toBeDefined();
  });

  it("normalizes a whitespace-only name/notes/internalNotes to null", () => {
    const result = parseRecurringInvoiceTemplateFields({ ...baseInput, name: "   ", notes: "  ", internalNotes: "  " });
    if (!result.ok) throw new Error("expected ok");
    expect(result.values.name).toBeNull();
    expect(result.values.notes).toBeNull();
    expect(result.values.internalNotes).toBeNull();
  });
});
