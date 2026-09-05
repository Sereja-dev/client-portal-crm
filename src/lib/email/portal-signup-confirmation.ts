import { sendEmailViaResend, type SendEmailFn } from "./resend-client";
import { buildEmailLegalFooterHtml, buildEmailLegalFooterText } from "./legal-footer";

/**
 * Portal signup-confirmation defect fix. The Client Portal counterpart to
 * src/lib/email/signup-confirmation.ts — this app must own the entire
 * confirmation link for Portal signup too (see
 * src/lib/auth/portal-signup-confirm-redirect.ts), never Supabase's own
 * template/hosted-verify flow, which a real Production smoke test found
 * does not deliver a server-visible token under this project's (default)
 * implicit flowType, and produces a generic, unbranded "Supabase Auth"
 * email in the meantime. Mirrors src/lib/email/signup-confirmation.ts's
 * exact shape and conventions, with Portal-specific copy.
 */

export type SendPortalSignupConfirmationEmailParams = {
  to: string;
  /** Already built by buildPortalSignupConfirmationUrl() — this module never constructs, parses, or validates a URL itself. */
  confirmUrl: string;
};

export type SendPortalSignupConfirmationEmailResult =
  | { delivered: true }
  | { delivered: false; reason: "not_configured" | "provider_error" | "network_error" };

export type SendPortalSignupConfirmationEmailFn = (
  params: SendPortalSignupConfirmationEmailParams,
  deps?: { sendEmail?: SendEmailFn },
) => Promise<SendPortalSignupConfirmationEmailResult>;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderHtml(params: { confirmUrl: string }): string {
  const confirmUrl = escapeHtml(params.confirmUrl);

  return `<!doctype html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: #111827; line-height: 1.5; margin: 0; padding: 24px;">
    <p>Confirm your email to finish creating your Client Portal account.</p>
    <p style="margin: 24px 0;">
      <a href="${confirmUrl}" style="display: inline-block; background: #000000; color: #ffffff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600;">
        Confirm your account
      </a>
    </p>
    <p style="color: #4b5563; font-size: 13px;">
      Or copy this link into your browser:<br />
      <span style="word-break: break-all;">${confirmUrl}</span>
    </p>
    <p style="color: #6b7280; font-size: 12px; margin-top: 32px;">
      If you didn't try to create a Client Portal account, you can safely ignore this email.
    </p>
    ${buildEmailLegalFooterHtml()}
  </body>
</html>`;
}

function renderText(params: { confirmUrl: string }): string {
  return [
    "Confirm your email to finish creating your Client Portal account.",
    "",
    `Confirm your account: ${params.confirmUrl}`,
    "",
    "If you didn't try to create a Client Portal account, you can safely ignore this email.",
    buildEmailLegalFooterText(),
  ].join("\n");
}

export type PortalSignupConfirmationEmailContent = { subject: string; html: string; text: string };

/**
 * The pure part of this module — no network, no env vars. Exported
 * specifically so it's unit-testable directly, the same shape
 * src/lib/email/signup-confirmation.ts's own buildSignupConfirmationEmailContent
 * already establishes.
 */
export function buildPortalSignupConfirmationEmailContent(params: { confirmUrl: string }): PortalSignupConfirmationEmailContent {
  return {
    subject: "Confirm your Aqenra Client Portal account",
    html: renderHtml(params),
    text: renderText(params),
  };
}

/**
 * Sends the Portal signup confirmation email via Resend. Server-only —
 * imported exclusively from src/app/portal/signup/actions.ts, never from
 * client code.
 *
 * Never throws: provider/network failures come back as a typed
 * `{ delivered: false, reason }`, matching every sibling email module's
 * own contract exactly. Never logs the recipient email, the confirmation
 * URL/token, or any provider response detail — only a coarse,
 * non-identifying reason ever reaches console.warn on failure.
 *
 * `deps.sendEmail` is the sole seam for tests — inject a fake to assert
 * on the recipient/link built here, or to simulate provider success/
 * failure, without a real network call.
 */
export const sendPortalSignupConfirmationEmail: SendPortalSignupConfirmationEmailFn = async (params, deps = {}) => {
  const sendEmail = deps.sendEmail ?? sendEmailViaResend;
  const fromEmail = process.env.INVITATION_FROM_EMAIL;

  if (!fromEmail) {
    return { delivered: false, reason: "not_configured" };
  }

  const content = buildPortalSignupConfirmationEmailContent(params);
  const result = await sendEmail({
    to: params.to,
    from: fromEmail,
    subject: content.subject,
    html: content.html,
    text: content.text,
  });

  if (!result.ok) {
    console.warn("[email] portal signup confirmation send failed", {
      flow: "portal_signup_confirmation",
      reason: result.reason,
    });
    return { delivered: false, reason: result.reason };
  }

  return { delivered: true };
};
