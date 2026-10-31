import { buildEmailLegalFooterHtml, buildEmailLegalFooterText } from "@/lib/email/legal-footer";
import { escapeHtml, escapeHtmlPreservingLineBreaks } from "@/lib/support-widget/email-content";
import type { BugDiagnostics } from "./diagnostics";

/**
 * Authenticated Staff Feedback Widget — the two outbound emails. Everything
 * user-supplied is HTML-escaped; subjects are built only from fields already
 * validated to be single-line. The sender's identity and workspace come from
 * the server-resolved session (see actions.ts) and are labelled as such, so a
 * support agent can trust them; nothing about them is taken from the form.
 */

export type FeedbackSender = {
  name: string | null;
  email: string;
  role: string;
};

export type FeedbackWorkspace = {
  id: string;
  name: string;
  slug: string;
};

export type FeedbackEmailContent = { subject: string; html: string; text: string };

const WRAPPER_STYLE =
  "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: #111827; line-height: 1.5; margin: 0; padding: 24px;";

function senderLines(sender: FeedbackSender, workspace: FeedbackWorkspace) {
  const who = sender.name ? `${sender.name} <${sender.email}>` : sender.email;
  return [
    ["From (signed-in account)", who],
    ["Role", sender.role],
    ["Workspace", `${workspace.name} (${workspace.slug})`],
    ["Workspace ID", workspace.id],
  ] as const;
}

function htmlRows(rows: ReadonlyArray<readonly [string, string]>): string {
  return rows.map(([label, value]) => `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`).join("\n    ");
}

export function buildStaffSupportEmailContent(params: {
  subject: string;
  message: string;
  sender: FeedbackSender;
  workspace: FeedbackWorkspace;
}): FeedbackEmailContent {
  const subject = `[Aqenra Support · Staff] ${params.subject}`;
  const rows = senderLines(params.sender, params.workspace);
  const html = `<!doctype html>
<html>
  <body style="${WRAPPER_STYLE}">
    <p>A signed-in Staff member sent a support request from inside the app.</p>
    ${htmlRows(rows)}
    <p><strong>Subject:</strong> ${escapeHtml(params.subject)}</p>
    <p><strong>Message:</strong></p>
    <p style="white-space: pre-wrap;">${escapeHtmlPreservingLineBreaks(params.message)}</p>
    <p style="color: #6b7280; font-size: 12px; margin-top: 32px;">
      Reply directly to this email to respond to ${escapeHtml(params.sender.email)}.
    </p>
    ${buildEmailLegalFooterHtml()}
  </body>
</html>`;
  const text = [
    "A signed-in Staff member sent a support request from inside the app.",
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    `Subject: ${params.subject}`,
    "",
    "Message:",
    params.message,
    "",
    `Reply directly to this email to respond to ${params.sender.email}.`,
    buildEmailLegalFooterText(),
  ].join("\n");
  return { subject, html, text };
}

export function buildBugReportEmailContent(params: {
  title: string;
  description: string;
  steps: string;
  expected: string;
  actual: string;
  diagnostics: BugDiagnostics;
  sender: FeedbackSender;
  workspace: FeedbackWorkspace;
}): FeedbackEmailContent {
  const subject = `[Aqenra Bug] ${params.title}`;
  const rows = senderLines(params.sender, params.workspace);
  const diagnosticRows = [
    ["Page", params.diagnostics.route],
    ["Submitted at (server time, UTC)", params.diagnostics.submittedAt],
    ["Browser / device", params.diagnostics.userAgent],
    ["Viewport", params.diagnostics.viewport],
  ] as const;

  const optionalHtml = (label: string, value: string) =>
    value ? `<p><strong>${escapeHtml(label)}:</strong></p>\n    <p style="white-space: pre-wrap;">${escapeHtmlPreservingLineBreaks(value)}</p>` : "";
  const optionalText = (label: string, value: string) => (value ? ["", `${label}:`, value] : []);

  const html = `<!doctype html>
<html>
  <body style="${WRAPPER_STYLE}">
    <p>A signed-in Staff member reported a bug from inside the app.</p>
    ${htmlRows(rows)}
    <p><strong>Title:</strong> ${escapeHtml(params.title)}</p>
    <p><strong>What went wrong:</strong></p>
    <p style="white-space: pre-wrap;">${escapeHtmlPreservingLineBreaks(params.description)}</p>
    <p><strong>Steps to reproduce:</strong></p>
    <p style="white-space: pre-wrap;">${escapeHtmlPreservingLineBreaks(params.steps)}</p>
    ${optionalHtml("Expected behavior", params.expected)}
    ${optionalHtml("Actual behavior", params.actual)}
    <p style="margin-top: 24px;"><strong>Diagnostic context (the only automatic context attached):</strong></p>
    ${htmlRows(diagnosticRows)}
    <p style="color: #6b7280; font-size: 12px; margin-top: 32px;">
      Reply directly to this email to respond to ${escapeHtml(params.sender.email)}.
    </p>
    ${buildEmailLegalFooterHtml()}
  </body>
</html>`;
  const text = [
    "A signed-in Staff member reported a bug from inside the app.",
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    `Title: ${params.title}`,
    "",
    "What went wrong:",
    params.description,
    "",
    "Steps to reproduce:",
    params.steps,
    ...optionalText("Expected behavior", params.expected),
    ...optionalText("Actual behavior", params.actual),
    "",
    "Diagnostic context (the only automatic context attached):",
    ...diagnosticRows.map(([label, value]) => `${label}: ${value}`),
    "",
    `Reply directly to this email to respond to ${params.sender.email}.`,
    buildEmailLegalFooterText(),
  ].join("\n");
  return { subject, html, text };
}
