import { CONTRACT_TITLE_MAX_LENGTH, CONTRACT_BODY_MAX_LENGTH, CONTRACT_INTERNAL_NOTES_MAX_LENGTH } from "@/lib/contracts/validation";

/**
 * Contract Templates V1. Deliberately a NEW, independent parser — never
 * imports Contract's own create/update parser (coupled to Contract-only
 * fields this model doesn't have: contractNumber, client/project/
 * signatory, issueDate/effectiveDate/a concrete expiresAt, status).
 * Reuses the exact same underlying, already domain-neutral length
 * constants that module itself exports (CONTRACT_TITLE_MAX_LENGTH,
 * CONTRACT_BODY_MAX_LENGTH, CONTRACT_INTERNAL_NOTES_MAX_LENGTH) — never
 * re-derives them — so a Contract Template can never accept a
 * title/body/internalNotes value ordinary Contract creation would
 * reject. Mirrors src/lib/invoice-templates/validation.ts's own
 * identical division of labor.
 *
 * No numeric money/line-item calculation exists here at all (unlike
 * Invoice/Quote Templates) — Contract has no line items and no money
 * fields; this module is pure structural/length validation only.
 */

export const CONTRACT_TEMPLATE_NAME_MAX_LENGTH = 100;
// Reused directly, never re-derived — see this module's own header comment.
export const CONTRACT_TEMPLATE_TITLE_MAX_LENGTH = CONTRACT_TITLE_MAX_LENGTH;
export const CONTRACT_TEMPLATE_BODY_MAX_LENGTH = CONTRACT_BODY_MAX_LENGTH;
export const CONTRACT_TEMPLATE_INTERNAL_NOTES_MAX_LENGTH = CONTRACT_INTERNAL_NOTES_MAX_LENGTH;

// A relative day-count, not an absolute date (see
// ContractTemplate.defaultExpiryOffsetDays's own schema comment). Minimum
// 0 is allowed (matching InvoiceTemplate.dueDateOffsetDays' own [0, 3650]
// bound, not QuoteTemplate.validityDays' minimum of 1) — a Contract
// expiring the same calendar day it's issued is a valid, if unusual,
// term, not an ambiguous "expires immediately." Maximum 3650 (10 years),
// matching both existing templates' own bound.
export const CONTRACT_TEMPLATE_EXPIRY_OFFSET_DAYS_MIN = 0;
export const CONTRACT_TEMPLATE_EXPIRY_OFFSET_DAYS_MAX = 3650;

export type ContractTemplateFieldErrors = Partial<Record<"name" | "title" | "body" | "internalNotes" | "defaultExpiryOffsetDays", string>>;

function trimmedOrNull(value: unknown): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Every field a caller may ever supply directly to create/update a
 * Contract Template's own content. Deliberately excludes organizationId,
 * createdByUserId, archivedAt, createdAt/updatedAt — none of these are
 * ever caller-supplied (see service.ts). Deliberately excludes
 * contractNumber/clientId/projectId/signatoryContactId/issueDate/
 * effectiveDate/a concrete expiresAt/status — Contract Templates V1
 * never accepts any of these (fixed Product decision; see
 * ContractTemplate's own schema comment).
 */
export type ContractTemplateWritableInput = {
  name: unknown;
  title: unknown;
  body: unknown;
  defaultExpiryOffsetDays?: unknown;
  internalNotes?: unknown;
};

export type ParsedContractTemplateValues = {
  name: string;
  title: string;
  body: string;
  defaultExpiryOffsetDays: number | null;
  internalNotes: string | null;
};

function parseExpiryOffsetDays(raw: unknown): { value: number | null; error?: string } {
  const trimmed = trimmedOrNull(raw);
  if (!trimmed) return { value: null };

  if (!/^\d+$/.test(trimmed)) {
    return { value: null, error: "Enter a whole number of days." };
  }
  const value = Number(trimmed);
  if (value < CONTRACT_TEMPLATE_EXPIRY_OFFSET_DAYS_MIN || value > CONTRACT_TEMPLATE_EXPIRY_OFFSET_DAYS_MAX) {
    return {
      value: null,
      error: `Enter a value between ${CONTRACT_TEMPLATE_EXPIRY_OFFSET_DAYS_MIN} and ${CONTRACT_TEMPLATE_EXPIRY_OFFSET_DAYS_MAX}.`,
    };
  }
  return { value };
}

export function parseContractTemplateInput(input: ContractTemplateWritableInput): {
  values: ParsedContractTemplateValues;
  fieldErrors: ContractTemplateFieldErrors;
} {
  const name = trimmedOrNull(input.name) ?? "";
  const title = trimmedOrNull(input.title) ?? "";
  // Body is deliberately NOT trimmed of internal whitespace/newlines —
  // only checked for "is there real content" via a trimmed-length probe,
  // matching Contract's own identical body-parsing discipline exactly
  // (src/lib/contracts/validation.ts's own parseContractInput). The
  // ORIGINAL, untrimmed string is what gets stored.
  const bodyRaw = typeof input.body === "string" ? input.body : "";
  const internalNotes = trimmedOrNull(input.internalNotes);

  const fieldErrors: ContractTemplateFieldErrors = {};

  if (!name) {
    fieldErrors.name = "Template name is required.";
  } else if (name.length > CONTRACT_TEMPLATE_NAME_MAX_LENGTH) {
    fieldErrors.name = `Must be ${CONTRACT_TEMPLATE_NAME_MAX_LENGTH} characters or fewer.`;
  }

  if (!title) {
    fieldErrors.title = "Contract title is required.";
  } else if (title.length > CONTRACT_TEMPLATE_TITLE_MAX_LENGTH) {
    fieldErrors.title = `Must be ${CONTRACT_TEMPLATE_TITLE_MAX_LENGTH} characters or fewer.`;
  }

  const bodyTrimmedLength = bodyRaw.trim().length;
  if (bodyTrimmedLength === 0) {
    fieldErrors.body = "Contract body is required.";
  } else if (bodyRaw.length > CONTRACT_TEMPLATE_BODY_MAX_LENGTH) {
    fieldErrors.body = `Must be ${CONTRACT_TEMPLATE_BODY_MAX_LENGTH} characters or fewer.`;
  }

  if (internalNotes && internalNotes.length > CONTRACT_TEMPLATE_INTERNAL_NOTES_MAX_LENGTH) {
    fieldErrors.internalNotes = `Must be ${CONTRACT_TEMPLATE_INTERNAL_NOTES_MAX_LENGTH} characters or fewer.`;
  }

  const { value: defaultExpiryOffsetDays, error: expiryError } = parseExpiryOffsetDays(input.defaultExpiryOffsetDays);
  if (expiryError) {
    fieldErrors.defaultExpiryOffsetDays = expiryError;
  }

  return {
    values: { name, title, body: bodyRaw, defaultExpiryOffsetDays, internalNotes },
    fieldErrors,
  };
}

export function hasContractTemplateFormErrors(fieldErrors: ContractTemplateFieldErrors): boolean {
  return Object.keys(fieldErrors).length > 0;
}
