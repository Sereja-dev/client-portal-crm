import { describe, expect, it } from "vitest";
import {
  parseContractTemplateInput,
  hasContractTemplateFormErrors,
  CONTRACT_TEMPLATE_NAME_MAX_LENGTH,
  CONTRACT_TEMPLATE_TITLE_MAX_LENGTH,
  CONTRACT_TEMPLATE_BODY_MAX_LENGTH,
  CONTRACT_TEMPLATE_INTERNAL_NOTES_MAX_LENGTH,
  CONTRACT_TEMPLATE_EXPIRY_OFFSET_DAYS_MIN,
  CONTRACT_TEMPLATE_EXPIRY_OFFSET_DAYS_MAX,
  type ContractTemplateWritableInput,
} from "@/lib/contract-templates/validation";
import { CONTRACT_TITLE_MAX_LENGTH, CONTRACT_BODY_MAX_LENGTH, CONTRACT_INTERNAL_NOTES_MAX_LENGTH } from "@/lib/contracts/validation";

function baseInput(overrides: Partial<ContractTemplateWritableInput> = {}): ContractTemplateWritableInput {
  return {
    name: "Standard services agreement",
    title: "Services Agreement",
    body: "These are the terms...",
    ...overrides,
  };
}

describe("parseContractTemplateInput — name", () => {
  it("rejects a blank name", () => {
    const { fieldErrors } = parseContractTemplateInput(baseInput({ name: "   " }));
    expect(fieldErrors.name).toBeDefined();
  });

  it("rejects a missing name", () => {
    const { fieldErrors } = parseContractTemplateInput(baseInput({ name: undefined }));
    expect(fieldErrors.name).toBeDefined();
  });

  it("trims whitespace from a valid name", () => {
    const { values, fieldErrors } = parseContractTemplateInput(baseInput({ name: "  Standard services agreement  " }));
    expect(fieldErrors.name).toBeUndefined();
    expect(values.name).toBe("Standard services agreement");
  });

  it(`rejects a name longer than ${CONTRACT_TEMPLATE_NAME_MAX_LENGTH} characters`, () => {
    const { fieldErrors } = parseContractTemplateInput(baseInput({ name: "x".repeat(CONTRACT_TEMPLATE_NAME_MAX_LENGTH + 1) }));
    expect(fieldErrors.name).toBeDefined();
  });

  it(`accepts a name exactly ${CONTRACT_TEMPLATE_NAME_MAX_LENGTH} characters long`, () => {
    const { fieldErrors } = parseContractTemplateInput(baseInput({ name: "x".repeat(CONTRACT_TEMPLATE_NAME_MAX_LENGTH) }));
    expect(fieldErrors.name).toBeUndefined();
  });

  it("does not require uniqueness -- two identically-named inputs both parse cleanly, with no lookup involved at all", () => {
    const a = parseContractTemplateInput(baseInput({ name: "Standard services agreement" }));
    const b = parseContractTemplateInput(baseInput({ name: "Standard services agreement" }));
    expect(a.fieldErrors.name).toBeUndefined();
    expect(b.fieldErrors.name).toBeUndefined();
  });
});

describe("parseContractTemplateInput — title", () => {
  it("reuses Contract's own CONTRACT_TITLE_MAX_LENGTH directly, never a re-derived constant", () => {
    expect(CONTRACT_TEMPLATE_TITLE_MAX_LENGTH).toBe(CONTRACT_TITLE_MAX_LENGTH);
  });

  it("rejects a blank title", () => {
    const { fieldErrors } = parseContractTemplateInput(baseInput({ title: "   " }));
    expect(fieldErrors.title).toBeDefined();
  });

  it("rejects a missing title", () => {
    const { fieldErrors } = parseContractTemplateInput(baseInput({ title: undefined }));
    expect(fieldErrors.title).toBeDefined();
  });

  it(`rejects a title longer than ${CONTRACT_TEMPLATE_TITLE_MAX_LENGTH} characters -- a Contract Template can never accept a title ordinary Contract creation would reject`, () => {
    const { fieldErrors } = parseContractTemplateInput(baseInput({ title: "x".repeat(CONTRACT_TEMPLATE_TITLE_MAX_LENGTH + 1) }));
    expect(fieldErrors.title).toBeDefined();
  });

  it(`accepts a title exactly ${CONTRACT_TEMPLATE_TITLE_MAX_LENGTH} characters long`, () => {
    const { fieldErrors } = parseContractTemplateInput(baseInput({ title: "x".repeat(CONTRACT_TEMPLATE_TITLE_MAX_LENGTH) }));
    expect(fieldErrors.title).toBeUndefined();
  });
});

describe("parseContractTemplateInput — body", () => {
  it("reuses Contract's own CONTRACT_BODY_MAX_LENGTH directly, never a re-derived constant", () => {
    expect(CONTRACT_TEMPLATE_BODY_MAX_LENGTH).toBe(CONTRACT_BODY_MAX_LENGTH);
  });

  it("rejects an all-whitespace body", () => {
    const { fieldErrors } = parseContractTemplateInput(baseInput({ body: "   \n\n  " }));
    expect(fieldErrors.body).toBeDefined();
  });

  it("rejects a missing body", () => {
    const { fieldErrors } = parseContractTemplateInput(baseInput({ body: undefined }));
    expect(fieldErrors.body).toBeDefined();
  });

  it("does NOT trim the body -- the original, untrimmed string is what's stored, matching Contract's own parseContractInput discipline exactly", () => {
    const { values, fieldErrors } = parseContractTemplateInput(baseInput({ body: "  Line one.\n\nLine two.  " }));
    expect(fieldErrors.body).toBeUndefined();
    expect(values.body).toBe("  Line one.\n\nLine two.  ");
  });

  it(`rejects a body longer than ${CONTRACT_TEMPLATE_BODY_MAX_LENGTH} characters`, () => {
    const { fieldErrors } = parseContractTemplateInput(baseInput({ body: "x".repeat(CONTRACT_TEMPLATE_BODY_MAX_LENGTH + 1) }));
    expect(fieldErrors.body).toBeDefined();
  });

  it(`accepts a body exactly ${CONTRACT_TEMPLATE_BODY_MAX_LENGTH} characters long`, () => {
    const { fieldErrors } = parseContractTemplateInput(baseInput({ body: "x".repeat(CONTRACT_TEMPLATE_BODY_MAX_LENGTH) }));
    expect(fieldErrors.body).toBeUndefined();
  });

  it("preserves HTML-like / script-like plain text verbatim -- never interpreted, escaped, or stripped at the validation layer (rendering-layer escaping is a separate, later concern)", () => {
    const raw = "<script>alert(1)</script> & \"quotes\" 'apostrophes'";
    const { values, fieldErrors } = parseContractTemplateInput(baseInput({ body: raw }));
    expect(fieldErrors.body).toBeUndefined();
    expect(values.body).toBe(raw);
  });
});

describe("parseContractTemplateInput — defaultExpiryOffsetDays", () => {
  it("null/absent means no default expiry", () => {
    const { values, fieldErrors } = parseContractTemplateInput(baseInput({ defaultExpiryOffsetDays: undefined }));
    expect(fieldErrors.defaultExpiryOffsetDays).toBeUndefined();
    expect(values.defaultExpiryOffsetDays).toBeNull();
  });

  it("accepts 0 -- 'expires the same day it's issued' is a meaningful value here", () => {
    const { values, fieldErrors } = parseContractTemplateInput(baseInput({ defaultExpiryOffsetDays: "0" }));
    expect(fieldErrors.defaultExpiryOffsetDays).toBeUndefined();
    expect(values.defaultExpiryOffsetDays).toBe(0);
  });

  it(`rejects a value below the minimum (${CONTRACT_TEMPLATE_EXPIRY_OFFSET_DAYS_MIN - 1})`, () => {
    const { fieldErrors } = parseContractTemplateInput(baseInput({ defaultExpiryOffsetDays: String(CONTRACT_TEMPLATE_EXPIRY_OFFSET_DAYS_MIN - 1) }));
    expect(fieldErrors.defaultExpiryOffsetDays).toBeDefined();
  });

  it(`accepts the maximum bound (${CONTRACT_TEMPLATE_EXPIRY_OFFSET_DAYS_MAX})`, () => {
    const { values, fieldErrors } = parseContractTemplateInput(baseInput({ defaultExpiryOffsetDays: String(CONTRACT_TEMPLATE_EXPIRY_OFFSET_DAYS_MAX) }));
    expect(fieldErrors.defaultExpiryOffsetDays).toBeUndefined();
    expect(values.defaultExpiryOffsetDays).toBe(CONTRACT_TEMPLATE_EXPIRY_OFFSET_DAYS_MAX);
  });

  it(`rejects ${CONTRACT_TEMPLATE_EXPIRY_OFFSET_DAYS_MAX + 1} (above the maximum)`, () => {
    const { fieldErrors } = parseContractTemplateInput(baseInput({ defaultExpiryOffsetDays: String(CONTRACT_TEMPLATE_EXPIRY_OFFSET_DAYS_MAX + 1) }));
    expect(fieldErrors.defaultExpiryOffsetDays).toBeDefined();
  });

  it("rejects a non-integer value", () => {
    const { fieldErrors } = parseContractTemplateInput(baseInput({ defaultExpiryOffsetDays: "14.5" }));
    expect(fieldErrors.defaultExpiryOffsetDays).toBeDefined();
  });

  it("rejects a negative value", () => {
    const { fieldErrors } = parseContractTemplateInput(baseInput({ defaultExpiryOffsetDays: "-5" }));
    expect(fieldErrors.defaultExpiryOffsetDays).toBeDefined();
  });
});

describe("parseContractTemplateInput — internalNotes", () => {
  it("reuses Contract's own CONTRACT_INTERNAL_NOTES_MAX_LENGTH directly, never a re-derived constant", () => {
    expect(CONTRACT_TEMPLATE_INTERNAL_NOTES_MAX_LENGTH).toBe(CONTRACT_INTERNAL_NOTES_MAX_LENGTH);
  });

  it("is optional -- null/absent is valid", () => {
    const { values, fieldErrors } = parseContractTemplateInput(baseInput({ internalNotes: undefined }));
    expect(fieldErrors.internalNotes).toBeUndefined();
    expect(values.internalNotes).toBeNull();
  });

  it(`rejects a value longer than ${CONTRACT_TEMPLATE_INTERNAL_NOTES_MAX_LENGTH} characters`, () => {
    const { fieldErrors } = parseContractTemplateInput(baseInput({ internalNotes: "x".repeat(CONTRACT_TEMPLATE_INTERNAL_NOTES_MAX_LENGTH + 1) }));
    expect(fieldErrors.internalNotes).toBeDefined();
  });

  it("is parsed independently from title/body -- a valid title/body never masks an invalid internalNotes value", () => {
    const { fieldErrors } = parseContractTemplateInput(baseInput({ internalNotes: "x".repeat(CONTRACT_TEMPLATE_INTERNAL_NOTES_MAX_LENGTH + 1) }));
    expect(fieldErrors.title).toBeUndefined();
    expect(fieldErrors.body).toBeUndefined();
    expect(fieldErrors.internalNotes).toBeDefined();
  });
});

describe("hasContractTemplateFormErrors", () => {
  it("is false for a clean, valid input", () => {
    const { fieldErrors } = parseContractTemplateInput(baseInput());
    expect(hasContractTemplateFormErrors(fieldErrors)).toBe(false);
  });

  it("is true when any field error exists", () => {
    const { fieldErrors } = parseContractTemplateInput(baseInput({ name: "" }));
    expect(hasContractTemplateFormErrors(fieldErrors)).toBe(true);
  });
});
