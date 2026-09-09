import "server-only";

/**
 * Section M — pure validation/normalization helpers, one per field type.
 * No database access here (SELECT's own "option must belong to this
 * definition and not be archived" rule needs a DB read, so that piece
 * lives in values.ts's own upsertCustomFieldValue, which calls into this
 * module only for the parts that are genuinely pure). Mirrors
 * src/lib/validation/lead.ts's own parseLeadValue discipline: reject a
 * malformed value here, never let it reach Postgres.
 */

// Matches CustomFieldValue.numberValue's own Decimal(10,2) column — same
// bound and reasoning as LEAD_VALUE_MAX in src/lib/validation/lead.ts.
export const CUSTOM_FIELD_NUMBER_MAX = 99_999_999.99;
export const CUSTOM_FIELD_NUMBER_MIN = -99_999_999.99;

// A generous but bounded cap for TEXT — same order of magnitude as
// LEAD_NOTES_MAX_LENGTH/COMMENT_BODY_MAX_LENGTH's own established
// "large freeform text field" convention.
export const CUSTOM_FIELD_TEXT_MAX_LENGTH = 10_000;

export type NormalizeResult<T> = { ok: true; value: T | null } | { ok: false; error: string };

/**
 * TEXT — string, trimmed. An empty (or whitespace-only) result is treated
 * as "clear this value" (Section M), so it normalizes to `null`, not an
 * empty string — the caller (upsertCustomFieldValue) then deletes the row
 * entirely rather than writing a meaningless empty textValue.
 */
export function normalizeTextValue(raw: unknown): NormalizeResult<string> {
  if (raw === null || raw === undefined) {
    return { ok: true, value: null };
  }
  if (typeof raw !== "string") {
    return { ok: false, error: "Enter text." };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: null };
  }
  if (trimmed.length > CUSTOM_FIELD_TEXT_MAX_LENGTH) {
    return { ok: false, error: `Must be ${CUSTOM_FIELD_TEXT_MAX_LENGTH} characters or fewer.` };
  }
  return { ok: true, value: trimmed };
}

/**
 * NUMBER — a valid finite decimal, compatible with numberValue's own
 * Decimal(10,2) column. Rejects NaN/Infinity and anything outside the
 * column's representable range. An empty string/null/undefined clears
 * the value, matching parseLeadValue's own "" -> null convention.
 */
export function normalizeNumberValue(raw: unknown): NormalizeResult<number> {
  if (raw === null || raw === undefined || raw === "") {
    return { ok: true, value: null };
  }
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(parsed)) {
    return { ok: false, error: "Enter a valid number." };
  }
  if (parsed < CUSTOM_FIELD_NUMBER_MIN || parsed > CUSTOM_FIELD_NUMBER_MAX) {
    return { ok: false, error: "This number is too large." };
  }
  return { ok: true, value: parsed };
}

/**
 * DATE — a real calendar date, normalized to a predictable UTC midnight
 * timestamp so no timezone can shift it to a different calendar day on
 * read-back (date-only semantics, applied at the application layer —
 * dateValue is a plain DateTime column, per this repo's own established
 * convention of never using `@db.Date`; see CustomFieldValue's own
 * schema comment). Accepts a `YYYY-MM-DD` string (the one unambiguous
 * shape a date-only `<input type="date">` produces) or a Date instance;
 * rejects anything else, including a full ISO datetime string, so a
 * caller can never accidentally smuggle in a time-of-day component that
 * would silently shift which calendar day gets stored.
 */
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function normalizeDateValue(raw: unknown): NormalizeResult<Date> {
  if (raw === null || raw === undefined || raw === "") {
    return { ok: true, value: null };
  }

  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) {
      return { ok: false, error: "Enter a valid date." };
    }
    const normalized = new Date(Date.UTC(raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate()));
    return { ok: true, value: normalized };
  }

  if (typeof raw !== "string") {
    return { ok: false, error: "Enter a valid date." };
  }

  const match = DATE_ONLY_PATTERN.exec(raw);
  if (!match) {
    return { ok: false, error: "Enter a valid date." };
  }
  const [, yearStr, monthStr, dayStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const normalized = new Date(Date.UTC(year, month - 1, day));
  // Guards against e.g. "2026-02-30" — Date.UTC silently rolls invalid
  // day-of-month values into the following month rather than rejecting
  // them, so round-tripping the components back out catches that.
  if (
    normalized.getUTCFullYear() !== year ||
    normalized.getUTCMonth() !== month - 1 ||
    normalized.getUTCDate() !== day
  ) {
    return { ok: false, error: "Enter a valid date." };
  }

  return { ok: true, value: normalized };
}

/** CHECKBOX — boolean only, no truthy/falsy coercion of strings/numbers. */
export function normalizeCheckboxValue(raw: unknown): NormalizeResult<boolean> {
  if (raw === null || raw === undefined) {
    return { ok: true, value: null };
  }
  if (typeof raw !== "boolean") {
    return { ok: false, error: "Must be true or false." };
  }
  return { ok: true, value: raw };
}

/**
 * SELECT — format-only validation (a well-formed selection id, or empty
 * to clear). Whether that id actually belongs to this definition and
 * isn't archived is a DB-dependent check this pure module deliberately
 * never performs — see upsertCustomFieldValue in values.ts, which is
 * where that verification actually happens (Section M/O).
 */
export function normalizeSelectValue(raw: unknown): NormalizeResult<string> {
  if (raw === null || raw === undefined || raw === "") {
    return { ok: true, value: null };
  }
  if (typeof raw !== "string") {
    return { ok: false, error: "Select a valid option." };
  }
  return { ok: true, value: raw };
}
