import { describe, expect, it } from "vitest";
import {
  parseInvoiceTemplateInput,
  hasInvoiceTemplateFormErrors,
  INVOICE_TEMPLATE_NAME_MAX_LENGTH,
  INVOICE_TEMPLATE_DUE_DATE_OFFSET_DAYS_MIN,
  INVOICE_TEMPLATE_DUE_DATE_OFFSET_DAYS_MAX,
  type InvoiceTemplateWritableInput,
} from "@/lib/invoice-templates/validation";

function baseInput(overrides: Partial<InvoiceTemplateWritableInput> = {}): InvoiceTemplateWritableInput {
  return {
    name: "Web design",
    currency: "USD",
    items: [{ description: "Design", quantity: "1", unitPrice: "100.00" }],
    ...overrides,
  };
}

describe("parseInvoiceTemplateInput — name", () => {
  it("rejects a blank name", () => {
    const { fieldErrors } = parseInvoiceTemplateInput(baseInput({ name: "   " }));
    expect(fieldErrors.name).toBeDefined();
  });

  it("rejects a missing name", () => {
    const { fieldErrors } = parseInvoiceTemplateInput(baseInput({ name: undefined }));
    expect(fieldErrors.name).toBeDefined();
  });

  it("trims whitespace from a valid name", () => {
    const { values, fieldErrors } = parseInvoiceTemplateInput(baseInput({ name: "  Web design  " }));
    expect(fieldErrors.name).toBeUndefined();
    expect(values.name).toBe("Web design");
  });

  it(`rejects a name longer than ${INVOICE_TEMPLATE_NAME_MAX_LENGTH} characters`, () => {
    const { fieldErrors } = parseInvoiceTemplateInput(baseInput({ name: "x".repeat(INVOICE_TEMPLATE_NAME_MAX_LENGTH + 1) }));
    expect(fieldErrors.name).toBeDefined();
  });

  it(`accepts a name exactly ${INVOICE_TEMPLATE_NAME_MAX_LENGTH} characters long`, () => {
    const { fieldErrors } = parseInvoiceTemplateInput(baseInput({ name: "x".repeat(INVOICE_TEMPLATE_NAME_MAX_LENGTH) }));
    expect(fieldErrors.name).toBeUndefined();
  });

  it("does not require uniqueness -- two identically-named inputs both parse cleanly, with no lookup involved at all", () => {
    const a = parseInvoiceTemplateInput(baseInput({ name: "Web design" }));
    const b = parseInvoiceTemplateInput(baseInput({ name: "Web design" }));
    expect(a.fieldErrors.name).toBeUndefined();
    expect(b.fieldErrors.name).toBeUndefined();
  });
});

describe("parseInvoiceTemplateInput — dueDateOffsetDays", () => {
  it("null/absent means no default due date", () => {
    const { values, fieldErrors } = parseInvoiceTemplateInput(baseInput({ dueDateOffsetDays: undefined }));
    expect(fieldErrors.dueDateOffsetDays).toBeUndefined();
    expect(values.dueDateOffsetDays).toBeNull();
  });

  it("accepts 0 -- 'due on receipt' is a meaningful value here, unlike QuoteTemplate's own validityDays minimum of 1", () => {
    const { values, fieldErrors } = parseInvoiceTemplateInput(baseInput({ dueDateOffsetDays: "0" }));
    expect(fieldErrors.dueDateOffsetDays).toBeUndefined();
    expect(values.dueDateOffsetDays).toBe(0);
  });

  it(`rejects a value below the minimum (${INVOICE_TEMPLATE_DUE_DATE_OFFSET_DAYS_MIN - 1})`, () => {
    const { fieldErrors } = parseInvoiceTemplateInput(baseInput({ dueDateOffsetDays: String(INVOICE_TEMPLATE_DUE_DATE_OFFSET_DAYS_MIN - 1) }));
    expect(fieldErrors.dueDateOffsetDays).toBeDefined();
  });

  it(`accepts the maximum bound (${INVOICE_TEMPLATE_DUE_DATE_OFFSET_DAYS_MAX})`, () => {
    const { values, fieldErrors } = parseInvoiceTemplateInput(baseInput({ dueDateOffsetDays: String(INVOICE_TEMPLATE_DUE_DATE_OFFSET_DAYS_MAX) }));
    expect(fieldErrors.dueDateOffsetDays).toBeUndefined();
    expect(values.dueDateOffsetDays).toBe(INVOICE_TEMPLATE_DUE_DATE_OFFSET_DAYS_MAX);
  });

  it(`rejects ${INVOICE_TEMPLATE_DUE_DATE_OFFSET_DAYS_MAX + 1} (above the maximum)`, () => {
    const { fieldErrors } = parseInvoiceTemplateInput(baseInput({ dueDateOffsetDays: String(INVOICE_TEMPLATE_DUE_DATE_OFFSET_DAYS_MAX + 1) }));
    expect(fieldErrors.dueDateOffsetDays).toBeDefined();
  });

  it("rejects a non-integer value", () => {
    const { fieldErrors } = parseInvoiceTemplateInput(baseInput({ dueDateOffsetDays: "14.5" }));
    expect(fieldErrors.dueDateOffsetDays).toBeDefined();
  });

  it("rejects a negative value", () => {
    const { fieldErrors } = parseInvoiceTemplateInput(baseInput({ dueDateOffsetDays: "-5" }));
    expect(fieldErrors.dueDateOffsetDays).toBeDefined();
  });
});

describe("parseInvoiceTemplateInput — currency", () => {
  it("rejects a missing currency", () => {
    const { fieldErrors } = parseInvoiceTemplateInput(baseInput({ currency: "" }));
    expect(fieldErrors.currency).toBeDefined();
  });

  it("rejects an unsupported currency code", () => {
    const { fieldErrors } = parseInvoiceTemplateInput(baseInput({ currency: "ZZZ" }));
    expect(fieldErrors.currency).toBeDefined();
  });

  it("normalizes a lowercase currency code", () => {
    const { values, fieldErrors } = parseInvoiceTemplateInput(baseInput({ currency: "eur" }));
    expect(fieldErrors.currency).toBeUndefined();
    expect(values.currency).toBe("EUR");
  });
});

describe("parseInvoiceTemplateInput — notes / internalNotes", () => {
  it("both are optional", () => {
    const { values, fieldErrors } = parseInvoiceTemplateInput(baseInput({ notes: undefined, internalNotes: undefined }));
    expect(fieldErrors.notes).toBeUndefined();
    expect(fieldErrors.internalNotes).toBeUndefined();
    expect(values.notes).toBeNull();
    expect(values.internalNotes).toBeNull();
  });

  it("both independently reject overlong text", () => {
    const tooLong = "x".repeat(10_001);
    const { fieldErrors } = parseInvoiceTemplateInput(baseInput({ notes: tooLong, internalNotes: tooLong }));
    expect(fieldErrors.notes).toBeDefined();
    expect(fieldErrors.internalNotes).toBeDefined();
  });

  it("internalNotes and notes are parsed independently -- a valid notes value never masks an invalid internalNotes value", () => {
    const { fieldErrors } = parseInvoiceTemplateInput(baseInput({ notes: "fine", internalNotes: "x".repeat(10_001) }));
    expect(fieldErrors.notes).toBeUndefined();
    expect(fieldErrors.internalNotes).toBeDefined();
  });
});

describe("parseInvoiceTemplateInput — discount/tax structural rules", () => {
  it("requires a discountValue when discountType is not NONE", () => {
    const { fieldErrors } = parseInvoiceTemplateInput(baseInput({ discountType: "PERCENTAGE", discountValue: undefined }));
    expect(fieldErrors.discountValue).toBeDefined();
  });

  it("does not require discountValue when discountType is NONE", () => {
    const { fieldErrors } = parseInvoiceTemplateInput(baseInput({ discountType: "NONE" }));
    expect(fieldErrors.discountValue).toBeUndefined();
  });

  it("rejects an invalid discountType, falling back to NONE", () => {
    const { values, fieldErrors } = parseInvoiceTemplateInput(baseInput({ discountType: "BOGUS" }));
    expect(fieldErrors.discountType).toBeDefined();
    expect(values.discountType).toBe("NONE");
  });

  it("rejects an invalid taxLabel, falling back to TAX", () => {
    const { values, fieldErrors } = parseInvoiceTemplateInput(baseInput({ taxLabel: "BOGUS" }));
    expect(fieldErrors.taxLabel).toBeDefined();
    expect(values.taxLabel).toBe("TAX");
  });

  it("accepts a valid VAT taxLabel", () => {
    const { values, fieldErrors } = parseInvoiceTemplateInput(baseInput({ taxLabel: "VAT" }));
    expect(fieldErrors.taxLabel).toBeUndefined();
    expect(values.taxLabel).toBe("VAT");
  });
});

describe("hasInvoiceTemplateFormErrors", () => {
  it("is false for a clean, valid input", () => {
    const { fieldErrors, itemErrors } = parseInvoiceTemplateInput(baseInput());
    expect(hasInvoiceTemplateFormErrors(fieldErrors, itemErrors)).toBe(false);
  });

  it("is true when any field error exists", () => {
    const { fieldErrors, itemErrors } = parseInvoiceTemplateInput(baseInput({ name: "" }));
    expect(hasInvoiceTemplateFormErrors(fieldErrors, itemErrors)).toBe(true);
  });
});
