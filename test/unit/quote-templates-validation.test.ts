import { describe, expect, it } from "vitest";
import {
  parseQuoteTemplateInput,
  hasQuoteTemplateFormErrors,
  QUOTE_TEMPLATE_NAME_MAX_LENGTH,
  QUOTE_TEMPLATE_VALIDITY_DAYS_MIN,
  QUOTE_TEMPLATE_VALIDITY_DAYS_MAX,
  type QuoteTemplateWritableInput,
} from "@/lib/quote-templates/validation";

function baseInput(overrides: Partial<QuoteTemplateWritableInput> = {}): QuoteTemplateWritableInput {
  return {
    name: "Web design",
    currency: "USD",
    items: [{ description: "Design", quantity: "1", unitPrice: "100.00" }],
    ...overrides,
  };
}

describe("parseQuoteTemplateInput — name", () => {
  it("rejects a blank name", () => {
    const { fieldErrors } = parseQuoteTemplateInput(baseInput({ name: "   " }));
    expect(fieldErrors.name).toBeDefined();
  });

  it("rejects a missing name", () => {
    const { fieldErrors } = parseQuoteTemplateInput(baseInput({ name: undefined }));
    expect(fieldErrors.name).toBeDefined();
  });

  it("trims whitespace from a valid name", () => {
    const { values, fieldErrors } = parseQuoteTemplateInput(baseInput({ name: "  Web design  " }));
    expect(fieldErrors.name).toBeUndefined();
    expect(values.name).toBe("Web design");
  });

  it(`rejects a name longer than ${QUOTE_TEMPLATE_NAME_MAX_LENGTH} characters`, () => {
    const { fieldErrors } = parseQuoteTemplateInput(baseInput({ name: "x".repeat(QUOTE_TEMPLATE_NAME_MAX_LENGTH + 1) }));
    expect(fieldErrors.name).toBeDefined();
  });

  it(`accepts a name exactly ${QUOTE_TEMPLATE_NAME_MAX_LENGTH} characters long`, () => {
    const { fieldErrors } = parseQuoteTemplateInput(baseInput({ name: "x".repeat(QUOTE_TEMPLATE_NAME_MAX_LENGTH) }));
    expect(fieldErrors.name).toBeUndefined();
  });

  it("does not require uniqueness -- two identically-named inputs both parse cleanly, with no lookup involved at all", () => {
    const a = parseQuoteTemplateInput(baseInput({ name: "Web design" }));
    const b = parseQuoteTemplateInput(baseInput({ name: "Web design" }));
    expect(a.fieldErrors.name).toBeUndefined();
    expect(b.fieldErrors.name).toBeUndefined();
  });
});

describe("parseQuoteTemplateInput — validityDays", () => {
  it("null/absent means no default validity", () => {
    const { values, fieldErrors } = parseQuoteTemplateInput(baseInput({ validityDays: undefined }));
    expect(fieldErrors.validityDays).toBeUndefined();
    expect(values.validityDays).toBeNull();
  });

  it(`rejects ${QUOTE_TEMPLATE_VALIDITY_DAYS_MIN - 1} (below the minimum)`, () => {
    const { fieldErrors } = parseQuoteTemplateInput(baseInput({ validityDays: String(QUOTE_TEMPLATE_VALIDITY_DAYS_MIN - 1) }));
    expect(fieldErrors.validityDays).toBeDefined();
  });

  it("rejects 0 -- zero must never silently mean 'today'", () => {
    const { fieldErrors } = parseQuoteTemplateInput(baseInput({ validityDays: "0" }));
    expect(fieldErrors.validityDays).toBeDefined();
  });

  it(`accepts the minimum bound (${QUOTE_TEMPLATE_VALIDITY_DAYS_MIN})`, () => {
    const { values, fieldErrors } = parseQuoteTemplateInput(baseInput({ validityDays: String(QUOTE_TEMPLATE_VALIDITY_DAYS_MIN) }));
    expect(fieldErrors.validityDays).toBeUndefined();
    expect(values.validityDays).toBe(QUOTE_TEMPLATE_VALIDITY_DAYS_MIN);
  });

  it(`accepts the maximum bound (${QUOTE_TEMPLATE_VALIDITY_DAYS_MAX})`, () => {
    const { values, fieldErrors } = parseQuoteTemplateInput(baseInput({ validityDays: String(QUOTE_TEMPLATE_VALIDITY_DAYS_MAX) }));
    expect(fieldErrors.validityDays).toBeUndefined();
    expect(values.validityDays).toBe(QUOTE_TEMPLATE_VALIDITY_DAYS_MAX);
  });

  it(`rejects ${QUOTE_TEMPLATE_VALIDITY_DAYS_MAX + 1} (above the maximum)`, () => {
    const { fieldErrors } = parseQuoteTemplateInput(baseInput({ validityDays: String(QUOTE_TEMPLATE_VALIDITY_DAYS_MAX + 1) }));
    expect(fieldErrors.validityDays).toBeDefined();
  });

  it("rejects a non-integer value", () => {
    const { fieldErrors } = parseQuoteTemplateInput(baseInput({ validityDays: "14.5" }));
    expect(fieldErrors.validityDays).toBeDefined();
  });

  it("rejects a negative value", () => {
    const { fieldErrors } = parseQuoteTemplateInput(baseInput({ validityDays: "-5" }));
    expect(fieldErrors.validityDays).toBeDefined();
  });
});

describe("parseQuoteTemplateInput — currency", () => {
  it("rejects a missing currency", () => {
    const { fieldErrors } = parseQuoteTemplateInput(baseInput({ currency: "" }));
    expect(fieldErrors.currency).toBeDefined();
  });

  it("rejects an unsupported currency code", () => {
    const { fieldErrors } = parseQuoteTemplateInput(baseInput({ currency: "ZZZ" }));
    expect(fieldErrors.currency).toBeDefined();
  });

  it("normalizes a lowercase currency code", () => {
    const { values, fieldErrors } = parseQuoteTemplateInput(baseInput({ currency: "eur" }));
    expect(fieldErrors.currency).toBeUndefined();
    expect(values.currency).toBe("EUR");
  });
});

describe("parseQuoteTemplateInput — discount/tax structural rules", () => {
  it("requires a discountValue when discountType is not NONE", () => {
    const { fieldErrors } = parseQuoteTemplateInput(baseInput({ discountType: "PERCENTAGE", discountValue: undefined }));
    expect(fieldErrors.discountValue).toBeDefined();
  });

  it("does not require discountValue when discountType is NONE", () => {
    const { fieldErrors } = parseQuoteTemplateInput(baseInput({ discountType: "NONE" }));
    expect(fieldErrors.discountValue).toBeUndefined();
  });

  it("rejects an invalid discountType, falling back to NONE", () => {
    const { values, fieldErrors } = parseQuoteTemplateInput(baseInput({ discountType: "BOGUS" }));
    expect(fieldErrors.discountType).toBeDefined();
    expect(values.discountType).toBe("NONE");
  });

  it("rejects an invalid taxLabel, falling back to TAX", () => {
    const { values, fieldErrors } = parseQuoteTemplateInput(baseInput({ taxLabel: "BOGUS" }));
    expect(fieldErrors.taxLabel).toBeDefined();
    expect(values.taxLabel).toBe("TAX");
  });

  it("accepts a valid VAT taxLabel", () => {
    const { values, fieldErrors } = parseQuoteTemplateInput(baseInput({ taxLabel: "VAT" }));
    expect(fieldErrors.taxLabel).toBeUndefined();
    expect(values.taxLabel).toBe("VAT");
  });
});

describe("hasQuoteTemplateFormErrors", () => {
  it("is false for a clean, valid input", () => {
    const { fieldErrors, itemErrors } = parseQuoteTemplateInput(baseInput());
    expect(hasQuoteTemplateFormErrors(fieldErrors, itemErrors)).toBe(false);
  });

  it("is true when any field error exists", () => {
    const { fieldErrors, itemErrors } = parseQuoteTemplateInput(baseInput({ name: "" }));
    expect(hasQuoteTemplateFormErrors(fieldErrors, itemErrors)).toBe(true);
  });
});
