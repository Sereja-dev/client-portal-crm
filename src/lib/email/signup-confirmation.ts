import { sendEmailViaResend, type SendEmailFn } from "./resend-client";
import { buildEmailLegalFooterHtml, buildEmailLegalFooterText } from "./legal-footer";

/**
 * Signup-confirmation defect fix (Invited Signup Confirmation Redirect
 * Investigation). This app's own branded replacement for Supabase's
 * native "Confirm signup" email — the whole reason this module exists is
 * that this app must own the entire confirmation link (see
 * src/lib/auth/signup-confirmation-token.ts and
 * src/lib/auth/signup-confirm-redirect.ts), never Supabase's own template/
 * hosted-verify flow, which the investigation this fix follows from found
 * does not deliver a server-visible token under this project's (default)
 * implicit flowType. Mirrors src/lib/email/password-reset.ts's exact
 * shape and conventions.
 */

export type SendSignupConfirmationEmailParams = {
  to: string;
  /** Already built by buildSignupConfirmationUrl() — this module never constructs, parses, or validates a URL itself. */
  confirmUrl: string;
  /** Purely a copy variant — never a security boundary. True only for an invitation-originated signup. */
  isInvited: boolean;
};

export type SendSignupConfirmationEmailResult =
  | { delivered: true }
  | { delivered: false; reason: "not_configured" | "provider_error" | "network_error" };

export type SendSignupConfirmationEmailFn = (
  params: SendSignupConfirmationEmailParams,
  deps?: { sendEmail?: SendEmailFn },
) => Promise<SendSignupConfirmationEmailResult>;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderHtml(params: { confirmUrl: string; isInvited: boolean }): string {
  const confirmUrl = escapeHtml(params.confirmUrl);
  const invitedNote = params.isInvited
    ? `<p style="color: #4b5563; font-size: 13px;">After confirming, you'll return to your invitation.</p>`
    : "";

  return `<!doctype html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: #111827; line-height: 1.5; margin: 0; padding: 24px;">
    <p>Confirm your email to finish creating your Aqenra account.</p>
    <p style="margin: 24px 0;">
      <a href="${confirmUrl}" style="display: inline-block; background: #000000; color: #ffffff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600;">
        Confirm your account
      </a>
    </p>
    <p style="color: #4b5563; font-size: 13px;">
      Or copy this link into your browser:<br />
      <span style="word-break: break-all;">${confirmUrl}</span>
    </p>
    ${invitedNote}
    <p style="color: #6b7280; font-size: 12px; margin-top: 32px;">
      If you didn't try to create an Aqenra account, you can safely ignore this email.
    </p>
    ${buildEmailLegalFooterHtml()}
  </body>
</html>`;
}

function renderText(params: { confirmUrl: string; isInvited: boolean }): string {
  return [
    "Confirm your email to finish creating your Aqenra account.",
    "",
    `Confirm your account: ${params.confirmUrl}`,
    ...(params.isInvited ? ["", "After confirming, you'll return to your invitation."] : []),
    "",
    "If you didn't try to create an Aqenra account, you can safely ignore this email.",
    buildEmailLegalFooterText(),
  ].join("\n");
}

export type SignupConfirmationEmailContent = { subject: string; html: string; text: string };

/**
 * The pure part of this module — no network, no env vars. Exported
 * specifically so it's unit-testable directly, the same shape
 * src/lib/email/password-reset.ts's own buildPasswordResetEmailContent
 * already establishes: this is what varies per input, sendEmailViaResend
 * (the network boundary) never does.
 */
export function buildSignupConfirmationEmailContent(params: {
  confirmUrl: string;
  isInvited: boolean;
}): SignupConfirmationEmailContent {
  return {
    subject: "Confirm your Aqenra account",
    html: renderHtml(params),
    text: renderText(params),
  };
}

/**
 * Sends the signup confirmation email via Resend. Server-only — imported
 * exclusively from src/app/(auth)/signup/actions.ts, never from client
 * code.
 *
 * Never throws: provider/network failures come back as a typed
 * `{ delivered: false, reason }`, matching every sibling email module's
 * own contract exactly (sendInvitationEmail, sendPasswordResetEmail).
 * Never logs the recipient email, the confirmation URL/token, or any
 * provider response detail — only a coarse, non-identifying reason ever
 * reaches console.warn on failure.
 *
 * `deps.sendEmail` is the sole seam for tests — inject a fake to assert
 * on the recipient/link built here, or to simulate provider success/
 * failure, without a real network call.
 */
export const sendSignupConfirmationEmail: SendSignupConfirmationEmailFn = async (params, deps = {}) => {
  const sendEmail = deps.sendEmail ?? sendEmailViaResend;
  const fromEmail = process.env.INVITATION_FROM_EMAIL;

  if (!fromEmail) {
    return { delivered: false, reason: "not_configured" };
  }

  const content = buildSignupConfirmationEmailContent(params);
  const result = await sendEmail({
    to: params.to,
    from: fromEmail,
    subject: content.subject,
    html: content.html,
    text: content.text,
  });

  if (!result.ok) {
    console.warn("[email] signup confirmation send failed", { flow: "signup_confirmation", reason: result.reason });
    return { delivered: false, reason: result.reason };
  }

  return { delivered: true };
};
