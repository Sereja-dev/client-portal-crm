import { buildEmailLegalFooterHtml, buildEmailLegalFooterText } from "@/lib/email/legal-footer";
import { SUPPORT_ISSUE_TYPE_LABELS, type SupportIssueType } from "./validation";

/**
 * Deliberately its own copy — matches password-reset.ts's own identical
 * escapeHtml, kept local to each email-template module rather than
 * shared, per this codebase's established convention.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escapes first, then converts a literal newline to a <br /> — never the other order, which would re-expose raw "<br />" markup to injection via a crafted "\\<br />" style input. */
function escapeHtmlPreservingLineBreaks(value: string): string {
  return escapeHtml(value).replace(/\n/g, "<br />");
}

export type SupportMessageEmailContentParams = {
  issueType: SupportIssueType;
  visitorEmail: string;
  message: string;
};

export type SupportMessageEmailContent = { subject: string; html: string; text: string };

/**
 * Pre-Auth Support Widget V1, Slice B. The subject is built entirely
 * from a fixed, server-owned string template and this module's own
 * SUPPORT_ISSUE_TYPE_LABELS lookup table — never the visitor's own
 * free-text message, and never the raw, unmapped `issueType` value
 * either (only ever one of the three fixed label strings, since
 * `issueType` is already validated against the strict allowlist in
 * validation.ts before this function is ever called). The visitor's
 * email and message both appear only in the body, both escaped for
 * HTML, never in the subject line, closing off subject-line header
 * injection as a category entirely rather than merely sanitizing it.
 */
export function buildSupportMessageEmailContent(params: SupportMessageEmailContentParams): SupportMessageEmailContent {
  const categoryLabel = SUPPORT_ISSUE_TYPE_LABELS[params.issueType];
  const subject = `[Aqenra Support] ${categoryLabel}`;

  const escapedCategory = escapeHtml(categoryLabel);
  const escapedEmail = escapeHtml(params.visitorEmail);
  const escapedMessage = escapeHtmlPreservingLineBreaks(params.message);

  const html = `<!doctype html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: #111827; line-height: 1.5; margin: 0; padding: 24px;">
    <p>A visitor submitted a support request through the pre-sign-in support form, before creating an account.</p>
    <p><strong>Category:</strong> ${escapedCategory}</p>
    <p><strong>From:</strong> ${escapedEmail}</p>
    <p><strong>Message:</strong></p>
    <p style="white-space: pre-wrap;">${escapedMessage}</p>
    <p style="color: #6b7280; font-size: 12px; margin-top: 32px;">
      Reply directly to this email to respond to ${escapedEmail}.
    </p>
    ${buildEmailLegalFooterHtml()}
  </body>
</html>`;

  const text = [
    "A visitor submitted a support request through the pre-sign-in support form, before creating an account.",
    "",
    `Category: ${categoryLabel}`,
    `From: ${params.visitorEmail}`,
    "",
    "Message:",
    params.message,
    "",
    `Reply directly to this email to respond to ${params.visitorEmail}.`,
    buildEmailLegalFooterText(),
  ].join("\n");

  return { subject, html, text };
}
