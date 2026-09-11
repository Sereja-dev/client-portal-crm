import { LEAD_NAME_MAX_LENGTH, LEAD_COMPANY_MAX_LENGTH, LEAD_EMAIL_MAX_LENGTH, LEAD_PHONE_MAX_LENGTH, LEAD_NOTES_MAX_LENGTH } from "./lead";
import {
  LEAD_CAPTURE_FORM_FIELD_KEYS,
  LEAD_CAPTURE_FORM_DEFAULT_LABELS,
  type ResolvedLeadCaptureFormFieldsConfig,
} from "@/lib/lead-capture-forms/fields";

/**
 * Public Lead Capture Forms, Phase 1. Mirrors src/lib/validation/lead.ts's
 * own conventions exactly where they apply (trim-then-null-if-empty,
 * length caps reused directly from that module rather than redeclared —
 * a public form's "message" ultimately lands in Lead.notes, and
 * name/company/email/phone land in the exact same Lead columns Lead's
 * own create flow validates, so the same caps must apply). EMAIL_PATTERN
 * itself is redeclared identically rather than imported — lead.ts keeps
 * its own copy private, matching this codebase's existing per-file
 * convention (see lead.ts's own comment referencing client.ts's separate
 * copy) rather than every validation module sharing one export.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const LEAD_CAPTURE_FORM_NAME_MAX_LENGTH = 200;
export const LEAD_CAPTURE_FORM_TITLE_MAX_LENGTH = 200;
export const LEAD_CAPTURE_FORM_DESCRIPTION_MAX_LENGTH = 2000;
export const LEAD_CAPTURE_FORM_SUCCESS_MESSAGE_MAX_LENGTH = 500;

function trimmedOrNull(value: unknown): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ---------------------------------------------------------------------------
// Staff-facing metadata (create/update a form's own name/title/description/
// successMessage) — never the public submission payload.
// ---------------------------------------------------------------------------

export type LeadCaptureFormMetadataInput = {
  name: unknown;
  title: unknown;
  description?: unknown;
  successMessage?: unknown;
};

export type LeadCaptureFormMetadataFieldErrors = Partial<Record<"name" | "title" | "description" | "successMessage", string>>;

export type ParsedLeadCaptureFormMetadata = {
  name: string;
  title: string;
  description: string | null;
  successMessage: string | null;
};

export function parseLeadCaptureFormMetadata(input: LeadCaptureFormMetadataInput): {
  values: ParsedLeadCaptureFormMetadata;
  fieldErrors: LeadCaptureFormMetadataFieldErrors;
} {
  const name = String(input.name ?? "").trim();
  const title = String(input.title ?? "").trim();
  const description = trimmedOrNull(input.description);
  const successMessage = trimmedOrNull(input.successMessage);

  const fieldErrors: LeadCaptureFormMetadataFieldErrors = {};

  if (!name) {
    fieldErrors.name = "Name is required.";
  } else if (name.length > LEAD_CAPTURE_FORM_NAME_MAX_LENGTH) {
    fieldErrors.name = `Must be ${LEAD_CAPTURE_FORM_NAME_MAX_LENGTH} characters or fewer.`;
  }

  if (!title) {
    fieldErrors.title = "Title is required.";
  } else if (title.length > LEAD_CAPTURE_FORM_TITLE_MAX_LENGTH) {
    fieldErrors.title = `Must be ${LEAD_CAPTURE_FORM_TITLE_MAX_LENGTH} characters or fewer.`;
  }

  if (description && description.length > LEAD_CAPTURE_FORM_DESCRIPTION_MAX_LENGTH) {
    fieldErrors.description = `Must be ${LEAD_CAPTURE_FORM_DESCRIPTION_MAX_LENGTH} characters or fewer.`;
  }

  if (successMessage && successMessage.length > LEAD_CAPTURE_FORM_SUCCESS_MESSAGE_MAX_LENGTH) {
    fieldErrors.successMessage = `Must be ${LEAD_CAPTURE_FORM_SUCCESS_MESSAGE_MAX_LENGTH} characters or fewer.`;
  }

  return { values: { name, title, description, successMessage }, fieldErrors };
}

// ---------------------------------------------------------------------------
// Public submission payload — every field a public visitor may ever
// supply. Deliberately excludes organizationId, statusDefinitionId, stage,
// source, assignedTo, convertedClientId, or any other privileged/internal
// value — those are never even representable in this input type, let
// alone read from it (see src/lib/lead-capture-forms/public.ts, the only
// caller).
// ---------------------------------------------------------------------------

export type PublicLeadCaptureSubmissionInput = {
  name?: unknown;
  company?: unknown;
  email?: unknown;
  phone?: unknown;
  message?: unknown;
  /** Honeypot — never persisted, never validated beyond "is it non-empty". */
  honeypot?: unknown;
};

export type PublicLeadCaptureFieldErrors = Partial<Record<"name" | "company" | "email" | "phone" | "message", string>>;

export type ParsedPublicLeadCaptureSubmission = {
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
};

/**
 * `resolvedFields` is the form's own already-resolved (every-key-present)
 * fields config — required-field enforcement only ever applies to a
 * VISIBLE field; a hidden field's own `required` flag is never enforced
 * (nothing renders for a visitor to fill in).
 */
export function parsePublicLeadCaptureSubmission(
  input: PublicLeadCaptureSubmissionInput,
  resolvedFields: ResolvedLeadCaptureFormFieldsConfig,
): { ok: true; values: ParsedPublicLeadCaptureSubmission } | { ok: false; fieldErrors: PublicLeadCaptureFieldErrors } {
  const name = trimmedOrNull(input.name) ?? "";
  const company = trimmedOrNull(input.company);
  const email = trimmedOrNull(input.email);
  const phone = trimmedOrNull(input.phone);
  const message = trimmedOrNull(input.message);

  const values: Record<(typeof LEAD_CAPTURE_FORM_FIELD_KEYS)[number], string | null> = {
    name: name || null,
    company,
    email,
    phone,
    message,
  };

  const fieldErrors: PublicLeadCaptureFieldErrors = {};

  for (const key of LEAD_CAPTURE_FORM_FIELD_KEYS) {
    const cfg = resolvedFields[key];
    if (cfg.visible && cfg.required && !values[key]) {
      fieldErrors[key] = `${cfg.label ?? LEAD_CAPTURE_FORM_DEFAULT_LABELS[key]} is required.`;
    }
  }

  // name is always required regardless of config (see
  // resolveLeadCaptureFormFieldsConfig's own comment) — this is belt-
  // and-suspenders defense in depth, not the primary enforcement.
  if (!name) {
    fieldErrors.name = fieldErrors.name ?? "Name is required.";
  } else if (name.length > LEAD_NAME_MAX_LENGTH) {
    fieldErrors.name = `Must be ${LEAD_NAME_MAX_LENGTH} characters or fewer.`;
  }

  if (company && company.length > LEAD_COMPANY_MAX_LENGTH) {
    fieldErrors.company = `Must be ${LEAD_COMPANY_MAX_LENGTH} characters or fewer.`;
  }

  if (email) {
    if (email.length > LEAD_EMAIL_MAX_LENGTH) {
      fieldErrors.email = `Must be ${LEAD_EMAIL_MAX_LENGTH} characters or fewer.`;
    } else if (!EMAIL_PATTERN.test(email)) {
      fieldErrors.email = "Enter a valid email address.";
    }
  }

  if (phone && phone.length > LEAD_PHONE_MAX_LENGTH) {
    fieldErrors.phone = `Must be ${LEAD_PHONE_MAX_LENGTH} characters or fewer.`;
  }

  if (message && message.length > LEAD_NOTES_MAX_LENGTH) {
    fieldErrors.message = `Must be ${LEAD_NOTES_MAX_LENGTH} characters or fewer.`;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  return { ok: true, values: { name, company, email, phone, message } };
}
