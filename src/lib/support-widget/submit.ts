import { sendEmailViaResend, type SendEmailFn } from "@/lib/email/resend-client";
import { buildSupportMessageEmailContent } from "./email-content";
import { resolveSupportRecipient } from "./config";
import {
  parseSupportMessageSubmission,
  type SupportMessageSubmissionInput,
  type SupportMessageFieldErrors,
} from "./validation";

export type SubmitSupportMessageResult =
  | { ok: true }
  // Honeypot populated — silently discarded. Deliberately the exact
  // same success shape a caller would branch on as a real send (see
  // submitPublicLeadCaptureForm's own identical `discarded: true`
  // variant) — nothing about the response itself ever signals "this was
  // detected as spam" back to whoever submitted it.
  | { ok: true; discarded: true }
  | { ok: false; reason: "VALIDATION"; fieldErrors: SupportMessageFieldErrors }
  // The support mailbox, the email provider, or both are not configured —
  // collapsed into one reason here; the caller (actions.ts) maps this to
  // the exact same generic visitor-facing message as SEND_FAILED, never
  // distinguishing "we're misconfigured" from "the provider rejected
  // this" to anyone outside the operator's own logs/monitoring.
  | { ok: false; reason: "NOT_CONFIGURED" }
  | { ok: false; reason: "SEND_FAILED" };

/**
 * Pre-Auth Support Widget V1, Slice B. The one orchestration function
 * that actually sends a support email — rate limiting is the caller's
 * responsibility (see actions.ts), the same layering
 * submitPublicLeadCaptureForm's own header comment establishes for its
 * sibling public form: kept out of this pure-ish domain function so it
 * stays independently testable without needing to also exercise or
 * reset the rate limiter's own shared state.
 *
 * Never accepts (or could accept — none of these are representable in
 * SupportMessageSubmissionInput at all) a recipient, a sender, or a
 * Reply-To from the caller: `to` is always `resolveSupportRecipient()`,
 * `from` is always `INVITATION_FROM_EMAIL`, and `replyTo` is always the
 * visitor's own already-validated email — the only one of the three
 * ever influenced by request input, and only after
 * `parseSupportMessageSubmission` has already confirmed it is a single,
 * safe, non-header-injecting address.
 *
 * `deps.sendEmail` is the sole seam for tests, matching
 * sendPasswordResetEmail's/sendInvitationEmail's own identical DI
 * pattern — inject a fake to assert on exactly what this function
 * builds and passes through, without a real network call.
 */
export async function submitSupportMessage(
  input: SupportMessageSubmissionInput,
  deps: { sendEmail?: SendEmailFn } = {},
): Promise<SubmitSupportMessageResult> {
  const sendEmail = deps.sendEmail ?? sendEmailViaResend;

  const honeypotValue = typeof input.honeypot === "string" ? input.honeypot.trim() : "";
  if (honeypotValue) {
    return { ok: true, discarded: true };
  }

  const parsed = parseSupportMessageSubmission(input);
  if (!parsed.ok) {
    return { ok: false, reason: "VALIDATION", fieldErrors: parsed.fieldErrors };
  }

  const fromEmail = process.env.INVITATION_FROM_EMAIL;
  const supportRecipient = resolveSupportRecipient();
  if (!fromEmail || !supportRecipient) {
    return { ok: false, reason: "NOT_CONFIGURED" };
  }

  const content = buildSupportMessageEmailContent({
    issueType: parsed.values.issueType,
    visitorEmail: parsed.values.email,
    message: parsed.values.message,
  });

  const result = await sendEmail({
    to: supportRecipient,
    from: fromEmail,
    subject: content.subject,
    html: content.html,
    text: content.text,
    // Always the visitor's own validated address, never the platform-
    // wide PLATFORM_REPLY_TO_EMAIL default — a real reply here must
    // reach the visitor, not Aqenra's own platform-support alias (see
    // resend-client.ts's own disablePlatformReplyTo doc comment for the
    // identical reasoning Invoice email already relies on). Supplying
    // replyTo alone already guarantees this override — disablePlatformReplyTo
    // is deliberately never also set here, since Slice A's own contract
    // treats setting both together as a caller error.
    replyTo: parsed.values.email,
  });

  if (!result.ok) {
    return { ok: false, reason: "SEND_FAILED" };
  }

  // Provider acceptance only — see this feature's own audit and
  // actions.ts's own visitor-facing copy for why this is never
  // presented as a delivery guarantee.
  return { ok: true };
}
