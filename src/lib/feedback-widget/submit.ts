import { sendEmailViaResend, type SendEmailFn } from "@/lib/email/resend-client";
import { resolveSupportRecipient } from "@/lib/support-widget/config";
import { resolveBugReportRecipient } from "./config";
import { buildBugDiagnostics } from "./diagnostics";
import { claimSubmission, contentFingerprint } from "./dedupe";
import { buildBugReportEmailContent, buildStaffSupportEmailContent, type FeedbackSender, type FeedbackWorkspace } from "./email-content";
import {
  parseBugReport,
  parseStaffSupport,
  type BugReportFieldErrors,
  type BugReportInput,
  type StaffSupportFieldErrors,
  type StaffSupportInput,
} from "./validation";

/**
 * Authenticated Staff Feedback Widget — the submission core. Independent of
 * FormData, the session and the rate limiter (all handled in actions.ts), so
 * every routing and safety decision here is testable with an injected sender.
 *
 * Routing is fixed in this file and never derived from input:
 *   support -> resolveSupportRecipient()    (PLATFORM_SUPPORT_EMAIL)
 *   bug     -> resolveBugReportRecipient()  (PLATFORM_BUG_REPORT_EMAIL)
 * A missing destination is NOT_CONFIGURED — the other destination is never
 * used as a fallback.
 */

export type StaffFeedbackIdentity = {
  userId: string;
  sender: FeedbackSender;
  workspace: FeedbackWorkspace;
};

type Deps = { sendEmail?: SendEmailFn; now?: () => Date };

export type SubmitResult<FieldErrors> =
  | { ok: true; duplicate?: true; discarded?: true }
  | { ok: false; reason: "VALIDATION"; fieldErrors: FieldErrors }
  | { ok: false; reason: "NOT_CONFIGURED" }
  | { ok: false; reason: "SEND_FAILED" };

function isHoneypotTriggered(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export async function submitStaffSupport(
  input: StaffSupportInput,
  identity: StaffFeedbackIdentity,
  deps: Deps = {},
): Promise<SubmitResult<StaffSupportFieldErrors>> {
  const sendEmail = deps.sendEmail ?? sendEmailViaResend;

  if (isHoneypotTriggered(input.honeypot)) return { ok: true, discarded: true };

  const parsed = parseStaffSupport(input);
  if (!parsed.ok) return { ok: false, reason: "VALIDATION", fieldErrors: parsed.fieldErrors };

  const fromEmail = process.env.INVITATION_FROM_EMAIL;
  const recipient = resolveSupportRecipient();
  if (!fromEmail || !recipient) return { ok: false, reason: "NOT_CONFIGURED" };

  const claim = claimSubmission(
    { userId: identity.userId, kind: "support" },
    { submissionId: parsed.values.submissionId, fingerprint: contentFingerprint([parsed.values.subject, parsed.values.message]) },
  );
  if (claim.duplicate) return { ok: true, duplicate: true };

  const content = buildStaffSupportEmailContent({
    subject: parsed.values.subject,
    message: parsed.values.message,
    sender: identity.sender,
    workspace: identity.workspace,
  });
  const result = await sendEmail({
    to: recipient,
    from: fromEmail,
    subject: content.subject,
    html: content.html,
    text: content.text,
    replyTo: identity.sender.email,
  });
  if (!result.ok) {
    claim.release();
    return { ok: false, reason: "SEND_FAILED" };
  }
  return { ok: true };
}

export async function submitBugReport(
  input: BugReportInput,
  identity: StaffFeedbackIdentity,
  context: { userAgent: unknown },
  deps: Deps = {},
): Promise<SubmitResult<BugReportFieldErrors>> {
  const sendEmail = deps.sendEmail ?? sendEmailViaResend;
  const now = deps.now ?? (() => new Date());

  if (isHoneypotTriggered(input.honeypot)) return { ok: true, discarded: true };

  const parsed = parseBugReport(input);
  if (!parsed.ok) return { ok: false, reason: "VALIDATION", fieldErrors: parsed.fieldErrors };

  const fromEmail = process.env.INVITATION_FROM_EMAIL;
  const recipient = resolveBugReportRecipient();
  if (!fromEmail || !recipient) return { ok: false, reason: "NOT_CONFIGURED" };

  const claim = claimSubmission(
    { userId: identity.userId, kind: "bug" },
    {
      submissionId: parsed.values.submissionId,
      fingerprint: contentFingerprint([parsed.values.title, parsed.values.description, parsed.values.steps, parsed.values.expected, parsed.values.actual]),
    },
  );
  if (claim.duplicate) return { ok: true, duplicate: true };

  const content = buildBugReportEmailContent({
    title: parsed.values.title,
    description: parsed.values.description,
    steps: parsed.values.steps,
    expected: parsed.values.expected,
    actual: parsed.values.actual,
    diagnostics: buildBugDiagnostics(input, { userAgent: context.userAgent, now: now() }),
    sender: identity.sender,
    workspace: identity.workspace,
  });
  const result = await sendEmail({
    to: recipient,
    from: fromEmail,
    subject: content.subject,
    html: content.html,
    text: content.text,
    replyTo: identity.sender.email,
  });
  if (!result.ok) {
    claim.release();
    return { ok: false, reason: "SEND_FAILED" };
  }
  return { ok: true };
}
