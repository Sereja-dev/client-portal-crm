import { checkEmailProviderReadiness } from "@/lib/email/resend-client";
import { resolveSupportRecipient } from "@/lib/support-widget/config";

/**
 * Authenticated Staff Feedback Widget — destination configuration.
 *
 * Support messages go to the SAME recipient the pre-auth support widget uses
 * (resolveSupportRecipient(): PLATFORM_SUPPORT_EMAIL, no fallback) — one
 * support mailbox, one resolver.
 *
 * Bug reports go to their OWN, separately configured destination,
 * PLATFORM_BUG_REPORT_EMAIL. There is deliberately no fallback of any kind:
 * not to PLATFORM_SUPPORT_EMAIL, not to INVITATION_FROM_EMAIL, not to any other
 * address. If it is unset or malformed, bug reporting is "not configured" and
 * the submission fails closed — a bug report is never silently delivered to an
 * unrelated mailbox. (The mailbox itself, e.g. bugs@aqenra.com, must be set up
 * and its delivery verified separately; this variable only names it.)
 */

const RECIPIENT_MAX_LENGTH = 254;
const RECIPIENT_PATTERN = /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/;

export function resolveBugReportRecipient(): string | null {
  const configured = process.env.PLATFORM_BUG_REPORT_EMAIL?.trim();
  if (!configured) return null;
  if (configured.length > RECIPIENT_MAX_LENGTH) return null;
  return RECIPIENT_PATTERN.test(configured) ? configured : null;
}

export type FeedbackReadiness = "ready" | "not_configured";

/** The email provider (FROM side) plus the support recipient (TO side) — the same two facts the pre-auth widget requires. */
export function checkStaffSupportReadiness(): FeedbackReadiness {
  if (checkEmailProviderReadiness() !== "ready") return "not_configured";
  return resolveSupportRecipient() === null ? "not_configured" : "ready";
}

/** The email provider plus the dedicated bug-report recipient. Independent of the support recipient. */
export function checkBugReportReadiness(): FeedbackReadiness {
  if (checkEmailProviderReadiness() !== "ready") return "not_configured";
  return resolveBugReportRecipient() === null ? "not_configured" : "ready";
}
