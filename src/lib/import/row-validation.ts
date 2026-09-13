import "server-only";
import { LeadSource } from "@/generated/prisma/enums";
import { parseClientBaseInput, type ParsedClientBaseInput } from "@/lib/validation/client";
import { parseLeadInput, type ParsedLeadInput, type LeadWritableInput } from "@/lib/validation/lead";
import { findDuplicateOrganizationClientByEmail } from "@/lib/clients/duplicate-email";
import type { ImportMapping } from "./mapping";
import type { ClientImportFieldKey, LeadImportFieldKey } from "./fields";
import { detectRowLengthMismatch } from "./csv-parse";

/**
 * CSV Import Phase 2 — the one shared "raw mapped row -> validated
 * entity input" layer, used identically by both the preview (dry-run)
 * step and the execute step (the approved architecture's own explicit
 * requirement: "Preview and final execution must use the same import
 * row validation functions"). Every actual field rule comes from this
 * app's existing validators (parseClientBaseInput, parseLeadInput) —
 * nothing here re-implements or loosens a single one of them.
 */

export type RowFieldValue = string | undefined;

/** Reads the mapped raw string for one Aqenra field out of a raw CSV row, given this row's own column mapping — undefined (never "") when unmapped, so parseClientBaseInput/parseLeadInput's own trimmedOrNull treats it identically to "not provided." */
function readMappedValue<Key extends string>(row: string[], mapping: ImportMapping<Key>, field: Key): RowFieldValue {
  const entry = mapping.find((m) => m.field === field);
  if (!entry) return undefined;
  return row[entry.columnIndex];
}

export type ClientRowValidationResult =
  | { ok: true; values: ParsedClientBaseInput }
  | { ok: false; outcome: "failed"; message: string }
  | { ok: false; outcome: "skipped"; message: string };

/**
 * One Client CSV row -> validated input, or a specific failed/skipped
 * outcome. `existingEmails` is the running set of emails already
 * claimed by an earlier row in THIS SAME execution (see the execute
 * step's own loop) — a DB-only duplicate check would never catch two
 * rows in the same file sharing one email, since neither exists in the
 * database yet when each is checked in isolation.
 */
export async function validateClientImportRow(
  organizationId: string,
  row: string[],
  headerCount: number,
  mapping: ImportMapping<ClientImportFieldKey>,
  existingEmailsInThisRun: ReadonlySet<string>,
): Promise<ClientRowValidationResult> {
  if (detectRowLengthMismatch(row, headerCount)) {
    return { ok: false, outcome: "failed", message: "Malformed row (wrong number of columns)." };
  }

  const { values, fieldErrors } = parseClientBaseInput({
    name: readMappedValue(row, mapping, "name"),
    company: readMappedValue(row, mapping, "company"),
    email: readMappedValue(row, mapping, "email"),
    phone: readMappedValue(row, mapping, "phone"),
    notes: readMappedValue(row, mapping, "notes"),
    billingLegalName: readMappedValue(row, mapping, "billingLegalName"),
    taxId: readMappedValue(row, mapping, "taxId"),
    streetAddress: readMappedValue(row, mapping, "streetAddress"),
    city: readMappedValue(row, mapping, "city"),
    state: readMappedValue(row, mapping, "state"),
    postalCode: readMappedValue(row, mapping, "postalCode"),
    country: readMappedValue(row, mapping, "country"),
  });

  const firstError = firstFieldError(fieldErrors);
  if (firstError) {
    return { ok: false, outcome: "failed", message: firstError };
  }

  // Client duplicates (Section: "Reuse existing Client duplicate-email
  // behavior") — same organization-scoped, case-insensitive check
  // createClientAction itself uses, applied here to both (a) any Client
  // already in the database and (b) any earlier row in this same
  // execution that already claimed this email (see this function's own
  // doc comment). Rows with no email are never deduplicated by name/
  // phone — the approved architecture's own explicit rule.
  if (values.email) {
    const normalizedEmail = values.email.toLowerCase();
    if (existingEmailsInThisRun.has(normalizedEmail)) {
      return { ok: false, outcome: "skipped", message: "Duplicate Client email — skipped." };
    }
    if (await findDuplicateOrganizationClientByEmail({ organizationId, email: values.email })) {
      return { ok: false, outcome: "skipped", message: "Duplicate Client email — skipped." };
    }
  }

  return { ok: true, values };
}

export type LeadRowValidationResult = { ok: true; values: ParsedLeadInput } | { ok: false; message: string };

const LEAD_SOURCE_VALUES = Object.values(LeadSource);

/**
 * Source: "accept case-insensitive matches against canonical existing
 * values... invalid non-empty value = row validation error... do not
 * guess." Normalizes a case-insensitive match to the canonical
 * uppercase enum value so it can be handed straight to parseLeadInput's
 * own (case-sensitive, exact-match) source validation, which then
 * naturally accepts it — no second, parallel source-validation rule.
 */
function normalizeLeadSourceForImport(raw: string | undefined): { ok: true; value: string | undefined } | { ok: false; message: string } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: true, value: undefined };
  const match = LEAD_SOURCE_VALUES.find((v) => v.toLowerCase() === trimmed.toLowerCase());
  if (!match) {
    return { ok: false, message: `Source: Unknown source "${trimmed}"` };
  }
  return { ok: true, value: match };
}

export async function validateLeadImportRow(
  row: string[],
  headerCount: number,
  mapping: ImportMapping<LeadImportFieldKey>,
): Promise<LeadRowValidationResult> {
  if (detectRowLengthMismatch(row, headerCount)) {
    return { ok: false, message: "Malformed row (wrong number of columns)." };
  }

  const rawSource = readMappedValue(row, mapping, "source");
  const normalizedSource = normalizeLeadSourceForImport(rawSource);
  if (!normalizedSource.ok) {
    return { ok: false, message: normalizedSource.message };
  }

  const input: LeadWritableInput = {
    name: readMappedValue(row, mapping, "name"),
    company: readMappedValue(row, mapping, "company"),
    email: readMappedValue(row, mapping, "email"),
    phone: readMappedValue(row, mapping, "phone"),
    source: normalizedSource.value,
    value: readMappedValue(row, mapping, "value"),
    notes: readMappedValue(row, mapping, "notes"),
    // assignedToUserId: never set — Phase 2's own locked scope excludes
    // Assignee mapping/import entirely; parseLeadInput's own optional
    // field simply stays absent, which it already treats as "no
    // assignee," identical to every other unmapped optional field.
  };

  const { values, fieldErrors } = parseLeadInput(input);
  const firstError = firstFieldError(fieldErrors);
  if (firstError) {
    return { ok: false, message: firstError };
  }

  // Lead duplicates: "No duplicate rule exists today... duplicate Leads
  // are allowed... do not invent email/phone/name deduplication" — no
  // check at all, by design.
  return { ok: true, values };
}

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  company: "Company",
  notes: "Notes",
  billingLegalName: "Billing Legal Name",
  taxId: "Tax ID",
  streetAddress: "Street Address",
  city: "City",
  state: "State",
  postalCode: "Postal Code",
  country: "Country",
  source: "Source",
  value: "Value",
};

/** "Row 12 — Name: Required"-style messages (the row number itself is prefixed by the caller, which knows the row's real position in the file) — never a raw Prisma/SQL error, matching the approved architecture's own Error UX requirement. */
function firstFieldError(fieldErrors: Record<string, string | undefined>): string | null {
  const [field, message] = Object.entries(fieldErrors).find(([, v]) => v !== undefined) ?? [];
  if (!field || !message) return null;
  const label = FIELD_LABELS[field] ?? field;
  return `${label}: ${message}`;
}
