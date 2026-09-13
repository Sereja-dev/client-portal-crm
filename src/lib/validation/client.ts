import type { ClientFormState } from "@/types";

export const CLIENT_STATUSES = ["LEAD", "ACTIVE", "INACTIVE", "ARCHIVED"] as const;
export type ClientStatusValue = (typeof CLIENT_STATUSES)[number];

// CSV Import Phase 2 — exported so src/lib/import/row-validation.ts can
// validate an imported row's email with the exact same rule, rather than
// forking a second pattern.
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Invoice System Slice 1 (docs/invoicing-architecture.md §4.4) — optional
// Client billing-identity fields, used by a future invoice PDF's "Bill To"
// block. Max lengths mirror this codebase's own convention of a generous,
// non-punitive cap on free-text fields (no per-country format validation,
// same "descriptive, not validated against a lookup" precedent
// OrganizationProfile's equivalent fields already use).
export const CLIENT_BILLING_MAX_LENGTHS = {
  billingLegalName: 200,
  taxId: 100,
  streetAddress: 500,
  city: 100,
  state: 100,
  postalCode: 32,
  country: 100,
} as const;

// CSV Import Phase 2 — Client.notes exists on the schema but has no
// interactive form/UI at all today (create or edit); this validator is
// its first real caller. Same cap this app's own established "large
// freeform text field" convention already uses elsewhere (Lead.notes'
// own LEAD_NOTES_MAX_LENGTH, Invoice notes, Comment body) — reused
// rather than inventing a fourth distinct cap for the same kind of
// field. Since the interactive ClientForm never submits a "notes" key
// at all, this is a fully inert addition for that path (always parses
// to null) and only ever meaningfully activates for CSV import.
export const CLIENT_NOTES_MAX_LENGTH = 10_000;

export type ParsedClientInput = {
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  status: ClientStatusValue;
  /**
   * Custom Statuses Phase 2B (Section L/R) — the real, authoritative
   * status identity the form's own `<select>` now submits (system or
   * custom CustomStatusDefinition id). `status` above is retained
   * unchanged (still parsed, still defaults to "LEAD" when absent — it
   * always is now, ClientForm no longer submits it) purely so this
   * type's existing shape/callers don't need to change; the real legacy
   * enum value written to the database is computed server-side in the
   * Server Action from the resolved definition, never from this field
   * directly (see createClientAction/updateClientAction's own comments).
   */
  statusDefinitionId: string;
  notes: string | null;
  billingLegalName: string | null;
  taxId: string | null;
  streetAddress: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
};

/** Trims, then treats an empty result as absent — matches src/lib/validation/company-profile.ts's own trimmedOrNull convention for optional fields. */
function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

// CSV Import Phase 2 — every field a caller may supply for the base
// Client fields (name/company/email/phone/billing-identity block),
// deliberately excluding status/statusDefinitionId: those are a
// per-caller concern (parseClientForm's own interactive-form-only
// requiredness rule below), never part of CSV import's Phase 2 field
// set at all (see the approved architecture: "For Phase 2, use the
// existing default/current create semantics... do not import arbitrary
// Client status from CSV").
export type ClientBaseInput = {
  name: unknown;
  company?: unknown;
  email?: unknown;
  phone?: unknown;
  notes?: unknown;
  billingLegalName?: unknown;
  taxId?: unknown;
  streetAddress?: unknown;
  city?: unknown;
  state?: unknown;
  postalCode?: unknown;
  country?: unknown;
};

export type ParsedClientBaseInput = Omit<ParsedClientInput, "status" | "statusDefinitionId">;

export type ClientBaseFieldErrors = Partial<Record<keyof ParsedClientBaseInput, string>>;

/**
 * The one shared base-field parser/validator — every rule here (name
 * required, email format, every billing-field max length) applies
 * identically whether the caller is the interactive ClientForm (via
 * parseClientForm below, which layers its own form-only status/
 * statusDefinitionId requiredness on top) or CSV import (via
 * src/lib/import/row-validation.ts, which never touches status at all).
 * Extracted from parseClientForm's own original body — no behavior
 * change for the interactive path, just a narrower, reusable core.
 */
export function parseClientBaseInput(input: ClientBaseInput): {
  values: ParsedClientBaseInput;
  fieldErrors: ClientBaseFieldErrors;
} {
  const name = String(input.name ?? "").trim();
  const company = trimmedOrNull(input.company as string | null | undefined);
  const email = trimmedOrNull(input.email as string | null | undefined);
  const phone = trimmedOrNull(input.phone as string | null | undefined);
  const notes = trimmedOrNull(input.notes as string | null | undefined);
  const billingLegalName = trimmedOrNull(input.billingLegalName as string | null | undefined);
  const taxId = trimmedOrNull(input.taxId as string | null | undefined);
  const streetAddress = trimmedOrNull(input.streetAddress as string | null | undefined);
  const city = trimmedOrNull(input.city as string | null | undefined);
  const state = trimmedOrNull(input.state as string | null | undefined);
  const postalCode = trimmedOrNull(input.postalCode as string | null | undefined);
  const country = trimmedOrNull(input.country as string | null | undefined);

  const fieldErrors: ClientBaseFieldErrors = {};

  if (!name) {
    fieldErrors.name = "Name is required.";
  }

  if (email && !EMAIL_PATTERN.test(email)) {
    fieldErrors.email = "Enter a valid email address.";
  }

  if (notes && notes.length > CLIENT_NOTES_MAX_LENGTH) {
    fieldErrors.notes = `Must be ${CLIENT_NOTES_MAX_LENGTH} characters or fewer.`;
  }

  // Optional billing fields: no required-ness check (null is always
  // valid) — only a max-length check, and only when a value was actually
  // provided.
  if (billingLegalName && billingLegalName.length > CLIENT_BILLING_MAX_LENGTHS.billingLegalName) {
    fieldErrors.billingLegalName = `Must be ${CLIENT_BILLING_MAX_LENGTHS.billingLegalName} characters or fewer.`;
  }
  if (taxId && taxId.length > CLIENT_BILLING_MAX_LENGTHS.taxId) {
    fieldErrors.taxId = `Must be ${CLIENT_BILLING_MAX_LENGTHS.taxId} characters or fewer.`;
  }
  if (streetAddress && streetAddress.length > CLIENT_BILLING_MAX_LENGTHS.streetAddress) {
    fieldErrors.streetAddress = `Must be ${CLIENT_BILLING_MAX_LENGTHS.streetAddress} characters or fewer.`;
  }
  if (city && city.length > CLIENT_BILLING_MAX_LENGTHS.city) {
    fieldErrors.city = `Must be ${CLIENT_BILLING_MAX_LENGTHS.city} characters or fewer.`;
  }
  if (state && state.length > CLIENT_BILLING_MAX_LENGTHS.state) {
    fieldErrors.state = `Must be ${CLIENT_BILLING_MAX_LENGTHS.state} characters or fewer.`;
  }
  if (postalCode && postalCode.length > CLIENT_BILLING_MAX_LENGTHS.postalCode) {
    fieldErrors.postalCode = `Must be ${CLIENT_BILLING_MAX_LENGTHS.postalCode} characters or fewer.`;
  }
  if (country && country.length > CLIENT_BILLING_MAX_LENGTHS.country) {
    fieldErrors.country = `Must be ${CLIENT_BILLING_MAX_LENGTHS.country} characters or fewer.`;
  }

  return {
    values: {
      name,
      company: company || null,
      email: email || null,
      phone: phone || null,
      notes,
      billingLegalName,
      taxId,
      streetAddress,
      city,
      state,
      postalCode,
      country,
    },
    fieldErrors,
  };
}

export function parseClientForm(formData: FormData): {
  values: ParsedClientInput;
  fieldErrors: NonNullable<ClientFormState["fieldErrors"]>;
} {
  const status = String(formData.get("status") ?? "LEAD");
  const statusDefinitionId = String(formData.get("statusDefinitionId") ?? "").trim();

  const { values: base, fieldErrors: baseFieldErrors } = parseClientBaseInput({
    name: formData.get("name"),
    company: formData.get("company"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    notes: formData.get("notes"),
    billingLegalName: formData.get("billingLegalName"),
    taxId: formData.get("taxId"),
    streetAddress: formData.get("streetAddress"),
    city: formData.get("city"),
    state: formData.get("state"),
    postalCode: formData.get("postalCode"),
    country: formData.get("country"),
  });

  const fieldErrors: NonNullable<ClientFormState["fieldErrors"]> = { ...baseFieldErrors };

  const isValidStatus = CLIENT_STATUSES.includes(status as ClientStatusValue);
  if (!isValidStatus) {
    fieldErrors.status = "Select a valid status.";
  }

  if (!statusDefinitionId) {
    fieldErrors.statusDefinitionId = "Select a status.";
  }

  return {
    values: {
      ...base,
      status: isValidStatus ? (status as ClientStatusValue) : "LEAD",
      statusDefinitionId,
    },
    fieldErrors,
  };
}
