import { LeadSource } from "@/generated/prisma/enums";
import type { LeadSource as LeadSourceValue } from "@/generated/prisma/enums";

/**
 * Leads / Sales Pipeline Phase 2. Plain-object input, not FormData — no
 * Lead form UI exists yet (Phase 3+), so there is nothing to bind a
 * useActionState/FormData-style parser against. Every action below takes
 * these already-typed inputs directly; a future form layer can build a
 * FormData -> this-shape adapter without this module changing at all.
 *
 * Mirrors src/lib/validation/client.ts's own conventions exactly where
 * they apply: trim-then-null-if-empty for optional text fields, the same
 * EMAIL_PATTERN, the same "field name -> error message" fieldErrors
 * shape. Diverges only where the task's own spec is explicit (bounded
 * max lengths on every free-text field, Decimal-safe `value` handling) —
 * neither Client nor Task enforces a max length on its own equivalent
 * text fields today, but this module does, per the approved Phase 2 spec.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const LEAD_SOURCES = Object.values(LeadSource);

export const LEAD_NAME_MAX_LENGTH = 200;
export const LEAD_COMPANY_MAX_LENGTH = 200;
export const LEAD_EMAIL_MAX_LENGTH = 320; // RFC 5321 maximum
export const LEAD_PHONE_MAX_LENGTH = 32;
// Matches this app's one existing convention for a large freeform text
// field (INVOICE_NOTES_MAX_LENGTH, COMMENT_BODY_MAX_LENGTH) — reused
// rather than inventing a third distinct cap for the same kind of field.
export const LEAD_NOTES_MAX_LENGTH = 10_000;
// Shorter than NOTES: a lost-reason is meant to be a brief explanation,
// not an open-ended writeup.
export const LEAD_LOST_REASON_MAX_LENGTH = 1_000;
// Lead.value is Decimal(10,2) at the database — 10 total digits, 2 after
// the decimal point, so the largest representable magnitude is
// 99,999,999.99. Validated here so a too-large input fails with a clear
// field error instead of a raw Postgres numeric-overflow error later.
export const LEAD_VALUE_MAX = 99_999_999.99;

export type LeadFieldErrors = Partial<
  Record<"name" | "company" | "email" | "phone" | "source" | "value" | "notes" | "assignedToUserId" | "lostReason", string>
>;

/** Trims, then treats an empty result as absent — matches client.ts's own trimmedOrNull. */
function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isValidLeadSource(value: unknown): value is LeadSourceValue {
  return typeof value === "string" && (LEAD_SOURCES as readonly string[]).includes(value);
}

/**
 * Parses `value` from whatever a caller might reasonably pass (a plain
 * number, or a numeric string — the shape a future form's own input would
 * arrive as) into either a valid non-negative number or an explicit
 * "invalid"/"absent" outcome. Never accepts NaN/Infinity, a negative
 * amount, or one that would overflow Lead.value's own Decimal(10,2)
 * column — this is intentionally the same "reject at the validation
 * layer, never let a malformed value reach Postgres" discipline
 * src/lib/validation/invoice.ts's own line-item quantity/discount
 * checks already use.
 */
function parseLeadValue(raw: unknown): { ok: true; value: number | null } | { ok: false } {
  if (raw === null || raw === undefined || raw === "") {
    return { ok: true, value: null };
  }
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > LEAD_VALUE_MAX) {
    return { ok: false };
  }
  return { ok: true, value: parsed };
}

/**
 * Every field a caller may ever supply directly to create/update a Lead.
 * Deliberately excludes organizationId, convertedClientId, convertedAt,
 * archivedAt, stage, and lostReason — those are either always
 * server-resolved or only ever set by their own dedicated action, never
 * accepted as generic create/edit input (see the actions themselves).
 */
export type LeadWritableInput = {
  name: unknown;
  company?: unknown;
  email?: unknown;
  phone?: unknown;
  source?: unknown;
  value?: unknown;
  notes?: unknown;
  assignedToUserId?: unknown;
};

export type ParsedLeadInput = {
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  source: LeadSourceValue | null;
  value: number | null;
  notes: string | null;
  assignedToUserId: string | null;
};

/**
 * Shared by createLeadAction and updateLeadAction — the same writable
 * field set, the same validation, for both. Callers that only want to
 * change a subset of fields (a real partial update) still pass every
 * field; there is no partial-object variant, matching updateClientAction/
 * updateTaskAction's own existing "always full values" convention (the
 * diff against the current row is computed separately, for Activity
 * metadata only — see lead-metadata.ts — never to decide which columns
 * to write).
 */
export function parseLeadInput(input: LeadWritableInput): {
  values: ParsedLeadInput;
  fieldErrors: LeadFieldErrors;
} {
  const name = String(input.name ?? "").trim();
  const company = trimmedOrNull(input.company as string | null | undefined);
  const email = trimmedOrNull(input.email as string | null | undefined);
  const phone = trimmedOrNull(input.phone as string | null | undefined);
  const notes = trimmedOrNull(input.notes as string | null | undefined);
  const assignedToUserId = trimmedOrNull(input.assignedToUserId as string | null | undefined);

  const fieldErrors: LeadFieldErrors = {};

  if (!name) {
    fieldErrors.name = "Name is required.";
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

  let source: LeadSourceValue | null = null;
  if (input.source !== undefined && input.source !== null && input.source !== "") {
    if (isValidLeadSource(input.source)) {
      source = input.source;
    } else {
      fieldErrors.source = "Select a valid source.";
    }
  }

  const parsedValue = parseLeadValue(input.value);
  if (!parsedValue.ok) {
    fieldErrors.value = "Enter a valid amount, zero or greater.";
  }

  if (notes && notes.length > LEAD_NOTES_MAX_LENGTH) {
    fieldErrors.notes = `Must be ${LEAD_NOTES_MAX_LENGTH} characters or fewer.`;
  }

  // Format only (a well-formed UUID) — whether this id actually belongs
  // to a Membership in the caller's own organization is verified
  // server-side by the action itself (requires a database read this pure
  // parser deliberately never does), never here.
  if (assignedToUserId && !isUuid(assignedToUserId)) {
    fieldErrors.assignedToUserId = "Select a valid team member.";
  }

  return {
    values: {
      name,
      company,
      email,
      phone,
      source,
      value: parsedValue.ok ? parsedValue.value : null,
      notes,
      assignedToUserId,
    },
    fieldErrors,
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * markLeadLostAction's own single field. Separate from LeadFieldErrors'
 * `lostReason` entry above (that one exists for the shared type but is
 * never populated by parseLeadInput itself, since lostReason isn't a
 * create/edit field — see markLeadLostAction).
 */
export function parseLostReason(raw: unknown): { ok: true; value: string | null } | { ok: false } {
  const trimmed = trimmedOrNull(raw as string | null | undefined);
  if (trimmed && trimmed.length > LEAD_LOST_REASON_MAX_LENGTH) {
    return { ok: false };
  }
  return { ok: true, value: trimmed };
}
