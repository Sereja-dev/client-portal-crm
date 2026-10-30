import { SUPPORT_MESSAGE_MAX_LENGTH, SUPPORT_MESSAGE_MIN_LENGTH } from "@/lib/support-widget/validation";

/**
 * Authenticated Staff Feedback Widget. Pure input validation for the two
 * tabs — "Support" (to the support mailbox) and "Report a bug" (to the
 * separately configured bug-report mailbox). Every field is trimmed and
 * length-bounded here, server-side, whatever the form's own maxLength
 * attributes claim. Account and workspace identity are NOT inputs: they are
 * resolved from the session in actions.ts, never read from FormData.
 *
 * The support message bounds deliberately reuse the pre-auth widget's own
 * exported constants — one set of limits for "a message to Aqenra Support".
 */

export const FEEDBACK_SUBJECT_MIN_LENGTH = 3;
export const FEEDBACK_SUBJECT_MAX_LENGTH = 120;
export const FEEDBACK_SUPPORT_MESSAGE_MIN_LENGTH = SUPPORT_MESSAGE_MIN_LENGTH;
export const FEEDBACK_SUPPORT_MESSAGE_MAX_LENGTH = SUPPORT_MESSAGE_MAX_LENGTH;
export const BUG_TITLE_MIN_LENGTH = 3;
export const BUG_TITLE_MAX_LENGTH = 120;
export const BUG_DESCRIPTION_MIN_LENGTH = 10;
export const BUG_DESCRIPTION_MAX_LENGTH = 4000;
export const BUG_STEPS_MIN_LENGTH = 10;
export const BUG_STEPS_MAX_LENGTH = 4000;
export const BUG_EXPECTED_MAX_LENGTH = 2000;
export const BUG_ACTUAL_MAX_LENGTH = 2000;

// A client-generated, opaque per-form-instance id used only to make a double
// click / retry of the same form idempotent (see dedupe.ts). Format-checked so
// it can never carry anything but a short token into a cache key.
const SUBMISSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

// Multi-line text: normalise line endings; drop control characters other than
// newline and tab (they have no legitimate place in a message body and would
// only corrupt the outbound email).
function toTrimmedMultiline(value: unknown): string {
  if (typeof value !== "string") return "";
  let out = "";
  for (const ch of value.replace(/\r\n?/g, "\n")) {
    const code = ch.charCodeAt(0);
    if (code === 0x0a || code === 0x09 || (code >= 0x20 && code !== 0x7f)) out += ch;
  }
  return out.trim();
}

export function parseSubmissionId(value: unknown): string | null {
  const id = toTrimmedString(value);
  return SUBMISSION_ID_PATTERN.test(id) ? id : null;
}

function checkSingleLine(
  value: string,
  label: string,
  min: number,
  max: number,
  errors: Record<string, string>,
  key: string,
): void {
  if (!value) {
    errors[key] = `${label} is required.`;
  } else if (hasControlCharacter(value)) {
    errors[key] = `${label} can't contain line breaks.`;
  } else if (value.length < min) {
    errors[key] = `${label} must be at least ${min} characters.`;
  } else if (value.length > max) {
    errors[key] = `${label} must be ${max} characters or fewer.`;
  }
}

function checkMultiline(
  value: string,
  label: string,
  min: number,
  max: number,
  errors: Record<string, string>,
  key: string,
): void {
  if (!value) {
    errors[key] = `${label} is required.`;
  } else if (value.length < min) {
    errors[key] = `${label} must be at least ${min} characters.`;
  } else if (value.length > max) {
    errors[key] = `${label} must be ${max} characters or fewer.`;
  }
}

// ---------------------------------------------------------------------------
// Support tab

export type StaffSupportInput = {
  subject?: unknown;
  message?: unknown;
  submissionId?: unknown;
  honeypot?: unknown;
};

export type StaffSupportFieldErrors = Partial<Record<"subject" | "message", string>>;

export type ParsedStaffSupport = { subject: string; message: string; submissionId: string | null };

export function parseStaffSupport(
  input: StaffSupportInput,
): { ok: true; values: ParsedStaffSupport } | { ok: false; fieldErrors: StaffSupportFieldErrors } {
  const subject = toTrimmedString(input.subject);
  const message = toTrimmedMultiline(input.message);
  const errors: Record<string, string> = {};
  checkSingleLine(subject, "Subject", FEEDBACK_SUBJECT_MIN_LENGTH, FEEDBACK_SUBJECT_MAX_LENGTH, errors, "subject");
  checkMultiline(message, "Message", FEEDBACK_SUPPORT_MESSAGE_MIN_LENGTH, FEEDBACK_SUPPORT_MESSAGE_MAX_LENGTH, errors, "message");
  if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors as StaffSupportFieldErrors };
  return { ok: true, values: { subject, message, submissionId: parseSubmissionId(input.submissionId) } };
}

// ---------------------------------------------------------------------------
// Bug report tab

export type BugReportInput = {
  title?: unknown;
  description?: unknown;
  steps?: unknown;
  expected?: unknown;
  actual?: unknown;
  route?: unknown;
  viewportWidth?: unknown;
  viewportHeight?: unknown;
  submissionId?: unknown;
  honeypot?: unknown;
};

export type BugReportFieldErrors = Partial<Record<"title" | "description" | "steps" | "expected" | "actual", string>>;

export type ParsedBugReport = {
  title: string;
  description: string;
  steps: string;
  expected: string;
  actual: string;
  submissionId: string | null;
};

export function parseBugReport(
  input: BugReportInput,
): { ok: true; values: ParsedBugReport } | { ok: false; fieldErrors: BugReportFieldErrors } {
  const title = toTrimmedString(input.title);
  const description = toTrimmedMultiline(input.description);
  const steps = toTrimmedMultiline(input.steps);
  const expected = toTrimmedMultiline(input.expected);
  const actual = toTrimmedMultiline(input.actual);
  const errors: Record<string, string> = {};
  checkSingleLine(title, "Title", BUG_TITLE_MIN_LENGTH, BUG_TITLE_MAX_LENGTH, errors, "title");
  checkMultiline(description, "Description", BUG_DESCRIPTION_MIN_LENGTH, BUG_DESCRIPTION_MAX_LENGTH, errors, "description");
  checkMultiline(steps, "Steps to reproduce", BUG_STEPS_MIN_LENGTH, BUG_STEPS_MAX_LENGTH, errors, "steps");
  if (expected.length > BUG_EXPECTED_MAX_LENGTH) errors.expected = `Must be ${BUG_EXPECTED_MAX_LENGTH} characters or fewer.`;
  if (actual.length > BUG_ACTUAL_MAX_LENGTH) errors.actual = `Must be ${BUG_ACTUAL_MAX_LENGTH} characters or fewer.`;
  if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors as BugReportFieldErrors };
  return { ok: true, values: { title, description, steps, expected, actual, submissionId: parseSubmissionId(input.submissionId) } };
}
