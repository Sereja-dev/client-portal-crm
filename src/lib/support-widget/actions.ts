"use server";

import { checkRateLimit, getRequestIp, SUPPORT_MESSAGE_SUBMIT_LIMIT } from "@/lib/rate-limit";
import { submitSupportMessage } from "./submit";
import type { SupportMessageFieldErrors } from "./validation";

/**
 * Pre-Auth Support Widget V1, Slice B. A plain Server Action bound to
 * the future widget's own `<form action={...}>` (Slice C) — the exact
 * same established shape every other genuinely-unauthenticated entry
 * point in this app already uses (signup, login, portal signup,
 * invitation accept, and most directly, submitLeadCaptureFormAction in
 * src/app/forms/[token]/actions.ts, whose own header comment explains
 * why: a Server Action already gets Next.js's own Origin check on every
 * request (the CSRF-equivalent protection) and the global
 * `serverActions.bodySizeLimit` (next.config.ts) for free — no hand-
 * rolled JSON Route Handler needed, and this app has no existing public
 * JSON API convention to follow in the first place.
 *
 * Deliberately thin: every real decision (rate-limit scope aside) lives
 * in submit.ts/validation.ts/config.ts/email-content.ts, all independently
 * testable without a FormData object or a rate-limit bucket in the way.
 */

export type SupportMessageSubmissionState = {
  error: string | null;
  fieldErrors?: SupportMessageFieldErrors;
  success?: boolean;
};

// Never distinguishes "not configured" from "provider rejected it" from
// "network failure" — one generic message for all three, matching
// submitLeadCaptureFormAction's own identical GENERIC_ERROR convention
// for its sibling public form.
const GENERIC_ERROR = "We couldn't send your message. Please try again in a moment.";

export async function submitSupportMessageAction(
  _prevState: SupportMessageSubmissionState,
  formData: FormData,
): Promise<SupportMessageSubmissionState> {
  // Keyed by IP — the only identity a public, unauthenticated submitter
  // has. Checked before any validation or send work, same ordering
  // submitLeadCaptureFormAction's own identical rate-limit check uses.
  const ip = await getRequestIp();
  const limitCheck = checkRateLimit(SUPPORT_MESSAGE_SUBMIT_LIMIT, ip);
  if (limitCheck.limited) {
    return { error: limitCheck.message };
  }

  const result = await submitSupportMessage({
    email: formData.get("email"),
    issueType: formData.get("issueType"),
    message: formData.get("message"),
    honeypot: formData.get("honeypot"),
  });

  if (result.ok) {
    // A honeypot-triggered discard (result.discarded === true) renders
    // identically to a real accepted send — no field in this response
    // ever distinguishes the two cases.
    return { error: null, success: true };
  }

  if (result.reason === "VALIDATION") {
    return { error: null, fieldErrors: result.fieldErrors };
  }

  // NOT_CONFIGURED and SEND_FAILED both collapse to the identical
  // generic message — never expose which, and never expose the
  // underlying provider_error/network_error/not_configured detail to
  // the visitor.
  return { error: GENERIC_ERROR };
}
