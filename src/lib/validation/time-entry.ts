import { parseDateOnly } from "@/lib/invoices/date-only";

/**
 * Time Tracking, Phase 1. Mirrors src/lib/validation/lead.ts's own
 * conventions exactly where they apply (trim-then-null-if-empty for the
 * optional free-text field, explicit max length, "field name -> error
 * message" fieldErrors shape). workDate parsing deliberately reuses
 * src/lib/invoices/date-only.ts's parseDateOnly as-is — that module is
 * already fully generic (no Invoice-specific coupling: no imports, no
 * Invoice-named types, pure functions) despite its current file
 * location, so this is a real reuse, not a duplicate copy — never a
 * second, parallel implementation of the same strict-date-only contract.
 */

// No firm number exists in the approved spec — chosen here as a
// deliberate, documented MVP ceiling: generous enough for a real work
// note, small enough to keep Activity metadata previews and ordinary
// list rendering cheap. Same order of magnitude as
// CLIENT_REQUEST_LOST_REASON_MAX_LENGTH-style "brief explanation" fields
// elsewhere in this app (Lead's own lostReason), not the much larger
// COMMENT_BODY_MAX_LENGTH/INVOICE_NOTES_MAX_LENGTH tier those exist for
// a genuinely long-form field.
export const TIME_ENTRY_DESCRIPTION_MAX_LENGTH = 1_000;

// A single entry can never exceed one full calendar day (1440 minutes) —
// the approved Phase 1 spec's own explicit ceiling; V1 stores duration
// only, never clock start/end times, so there is no separate
// overlapping-time concern to also validate.
export const TIME_ENTRY_DURATION_MIN_MINUTES = 1;
export const TIME_ENTRY_DURATION_MAX_MINUTES = 1_440;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export type TimeEntryFieldErrors = Partial<
  Record<"userId" | "projectId" | "taskId" | "workDate" | "durationMinutes" | "description", string>
>;

/**
 * Integer minutes only, 1..1440 inclusive. Accepts a plain number or a
 * numeric string (the shape a future form's own input would arrive as);
 * never accepts NaN/Infinity, a fractional value, or one outside range —
 * same "reject at the validation layer, never let a malformed value
 * reach Postgres" discipline every other numeric validator in this app
 * already uses (see e.g. validation/lead.ts's own parseLeadValue).
 */
export function parseDurationMinutes(raw: unknown): { ok: true; value: number } | { ok: false } {
  if (typeof raw !== "number" && typeof raw !== "string") {
    return { ok: false };
  }
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return { ok: false };
  }
  if (parsed < TIME_ENTRY_DURATION_MIN_MINUTES || parsed > TIME_ENTRY_DURATION_MAX_MINUTES) {
    return { ok: false };
  }
  return { ok: true, value: parsed };
}

/**
 * Strict "YYYY-MM-DD" calendar-date parsing via the existing
 * parseDateOnly — never raw `new Date(userInput)`. The returned Date
 * always represents 00:00:00.000 UTC on the named calendar date, the
 * same persisted convention Invoice.issueDate/dueDate already use.
 */
export function parseTimeEntryWorkDate(raw: unknown): { ok: true; date: Date } | { ok: false } {
  if (typeof raw !== "string") {
    return { ok: false };
  }
  const result = parseDateOnly(raw);
  if (!result.ok) {
    return { ok: false };
  }
  return { ok: true, date: result.date };
}

/** Trims; empty-after-trim becomes null. Rejects (does not silently truncate) an over-length value. */
export function normalizeTimeEntryDescription(raw: unknown): { ok: true; value: string | null } | { ok: false } {
  const trimmed = String(raw ?? "").trim();
  if (trimmed.length === 0) {
    return { ok: true, value: null };
  }
  if (trimmed.length > TIME_ENTRY_DESCRIPTION_MAX_LENGTH) {
    return { ok: false };
  }
  return { ok: true, value: trimmed };
}

export type ParsedTimeEntryFields = {
  workDate: Date;
  durationMinutes: number;
  description: string | null;
};

/**
 * The three free-form fields every create/update call must (re-)validate
 * when supplied — shared by createTimeEntry (all three always required)
 * and updateTimeEntry (each validated only when actually present in the
 * partial input; see entries.ts for how the two callers differ).
 */
export function parseTimeEntryFields(input: {
  workDate: unknown;
  durationMinutes: unknown;
  description?: unknown;
}): { ok: true; values: ParsedTimeEntryFields } | { ok: false; fieldErrors: TimeEntryFieldErrors } {
  const fieldErrors: TimeEntryFieldErrors = {};

  const workDateResult = parseTimeEntryWorkDate(input.workDate);
  if (!workDateResult.ok) {
    fieldErrors.workDate = "Enter a valid date (YYYY-MM-DD).";
  }

  const durationResult = parseDurationMinutes(input.durationMinutes);
  if (!durationResult.ok) {
    fieldErrors.durationMinutes = `Enter a whole number of minutes between ${TIME_ENTRY_DURATION_MIN_MINUTES} and ${TIME_ENTRY_DURATION_MAX_MINUTES}.`;
  }

  const descriptionResult = normalizeTimeEntryDescription(input.description);
  if (!descriptionResult.ok) {
    fieldErrors.description = `Must be ${TIME_ENTRY_DESCRIPTION_MAX_LENGTH} characters or fewer.`;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  return {
    ok: true,
    values: {
      workDate: (workDateResult as { ok: true; date: Date }).date,
      durationMinutes: (durationResult as { ok: true; value: number }).value,
      description: (descriptionResult as { ok: true; value: string | null }).value,
    },
  };
}
