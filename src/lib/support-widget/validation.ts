/**
 * Pre-Auth Support Widget V1, Slice B. Validation for the one public,
 * unauthenticated submission this feature accepts — mirrors
 * src/lib/validation/lead-capture-form.ts's own established discipline
 * (trim-then-validate, a fixed field-error shape, never throw) for this
 * repo's other genuinely-public form. Deliberately its own narrow module,
 * not a general-purpose schema library: three fields, three rules each.
 */

export const SUPPORT_ISSUE_TYPES = ["cant-sign-up", "cant-sign-in", "other"] as const;
export type SupportIssueType = (typeof SUPPORT_ISSUE_TYPES)[number];

/** Server-owned labels only — never rendered from raw visitor text (see email-content.ts). */
export const SUPPORT_ISSUE_TYPE_LABELS: Record<SupportIssueType, string> = {
  "cant-sign-up": "Can't sign up",
  "cant-sign-in": "Can't sign in",
  other: "Other issue",
};

export const SUPPORT_EMAIL_MAX_LENGTH = 254;
export const SUPPORT_MESSAGE_MIN_LENGTH = 20;
export const SUPPORT_MESSAGE_MAX_LENGTH = 4000;

function hasHeaderInjectionCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    // Any C0 control character (includes CR 0x0D, LF 0x0A, NUL, tab) or DEL.
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Deliberately its own copy, not an import from resend-client.ts or
 * platform-config.ts — matches this codebase's established convention
 * (see password-reset.ts's getAppBaseUrl comment, and resend-client.ts's
 * own identical reasoning for its Slice A replyTo validator) that each
 * module this close to a security boundary keeps its own narrow copy,
 * so one module's own rule can never silently drift because of an edit
 * made for a different module's reasons. This value will itself become
 * the email's Reply-To address downstream (src/lib/support-widget/
 * submit.ts), so it is validated exactly as strictly as Slice A's own
 * replyTo contract already requires: a single bare mailbox address,
 * no comma (rules out an address list), no angle brackets (rules out a
 * "Display Name <addr>" wrapper).
 */
const SUPPORT_VISITOR_EMAIL_PATTERN = /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/;

function isValidVisitorEmail(value: string): boolean {
  if (value.length === 0 || value.length > SUPPORT_EMAIL_MAX_LENGTH) return false;
  if (hasHeaderInjectionCharacter(value)) return false;
  return SUPPORT_VISITOR_EMAIL_PATTERN.test(value);
}

function isValidIssueType(value: string): value is SupportIssueType {
  return (SUPPORT_ISSUE_TYPES as readonly string[]).includes(value);
}

/**
 * FormData.get() already returns only the first value for a repeated
 * key, and only ever a `string | File` — never an array (per the
 * platform FormData spec) — so "duplicate keys" and "non-string values"
 * both collapse to this one normalization: a File (or any other
 * non-string) becomes `""`, which then fails the relevant required-field
 * check below exactly like a genuinely empty submission would, never
 * thrown or treated as a type error. An extremely large individual
 * string value is still bounded by this app's own global Server Action
 * body-size cap (next.config.ts's `serverActions.bodySizeLimit`) before
 * this function ever runs, and further bounded here by each field's own
 * explicit max-length check below.
 */
function toTrimmedString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

export type SupportMessageSubmissionInput = {
  email?: unknown;
  issueType?: unknown;
  message?: unknown;
  /** Honeypot — never persisted, never validated beyond "is it non-empty" (see submit.ts). */
  honeypot?: unknown;
};

export type SupportMessageFieldErrors = Partial<Record<"email" | "issueType" | "message", string>>;

export type ParsedSupportMessageSubmission = {
  email: string;
  issueType: SupportIssueType;
  message: string;
};

export function parseSupportMessageSubmission(
  input: SupportMessageSubmissionInput,
): { ok: true; values: ParsedSupportMessageSubmission } | { ok: false; fieldErrors: SupportMessageFieldErrors } {
  const email = toTrimmedString(input.email);
  const issueTypeRaw = toTrimmedString(input.issueType);
  const message = toTrimmedString(input.message);

  const fieldErrors: SupportMessageFieldErrors = {};

  if (!email) {
    fieldErrors.email = "Email is required.";
  } else if (!isValidVisitorEmail(email)) {
    fieldErrors.email = "Enter a valid email address.";
  }

  if (!issueTypeRaw) {
    fieldErrors.issueType = "Select an issue type.";
  } else if (!isValidIssueType(issueTypeRaw)) {
    fieldErrors.issueType = "Select a valid issue type.";
  }

  if (!message) {
    fieldErrors.message = "Message is required.";
  } else if (message.length < SUPPORT_MESSAGE_MIN_LENGTH) {
    fieldErrors.message = `Please describe the issue in at least ${SUPPORT_MESSAGE_MIN_LENGTH} characters.`;
  } else if (message.length > SUPPORT_MESSAGE_MAX_LENGTH) {
    fieldErrors.message = `Must be ${SUPPORT_MESSAGE_MAX_LENGTH} characters or fewer.`;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  // isValidIssueType has already narrowed issueTypeRaw by this point for
  // every path that reaches here (no fieldErrors.issueType was set).
  return { ok: true, values: { email, issueType: issueTypeRaw as SupportIssueType, message } };
}
