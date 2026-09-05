"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateUser, getOrCreateOrganizationId } from "@/lib/current-user";
import { withToast } from "@/lib/toast-url";
import { sanitizeRedirectPath } from "@/lib/safe-redirect";
import { checkRateLimit, getRequestIp, SIGNUP_LIMIT } from "@/lib/rate-limit";
import { resolveValidSignupInvitation } from "@/lib/invitations/resolve-signup-invitation";
import {
  generateSignupConfirmationToken,
  type GenerateSignupConfirmationTokenFn,
} from "@/lib/auth/signup-confirmation-token";
import { buildSignupConfirmationUrl } from "@/lib/auth/signup-confirm-redirect";
import {
  sendSignupConfirmationEmail,
  type SendSignupConfirmationEmailFn,
} from "@/lib/email/signup-confirmation";
import type { AuthActionState } from "@/types";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export type SignupDeps = {
  generateToken?: GenerateSignupConfirmationTokenFn;
  sendConfirmationEmail?: SendSignupConfirmationEmailFn;
};

/**
 * Signup-confirmation defect fix (Invited Signup Confirmation Redirect
 * Investigation). Never calls supabase.auth.signUp() — that call cannot
 * have its native "Confirm signup" email suppressed while still creating
 * the user, and that native email's confirmation link, under this
 * project's (default, unchanged — see the investigation's own explicit
 * instruction not to touch flowType) implicit flowType, never delivers a
 * server-visible token to any redirect target. Instead:
 *
 *   1. generateToken() (default: generateSignupConfirmationToken, wrapping
 *      Supabase's Admin API `generateLink({type:"signup",...})`) both
 *      creates the auth user and returns a real, server-generated
 *      `hashed_token` — no email is sent by Supabase at any point.
 *   2. If the project auto-confirms new users (`alreadyConfirmed: true` —
 *      the exact "Confirm email disabled" case that used to give an
 *      immediate session via signUp()'s own return value), this
 *      establishes that same session synchronously here, via the exact
 *      real verifyOtp() call src/lib/auth/recovery-token.ts's own
 *      verifyRecoveryToken() already relies on to persist a session
 *      through the request-scoped cookie adapter.
 *   3. Otherwise, this app sends its own branded confirmation email via
 *      Resend (sendConfirmationEmail, default: sendSignupConfirmationEmail),
 *      linking to this app's own /auth/confirm route with that same
 *      token_hash — the exact URL shape that route's existing type=signup
 *      branch already verifies and redirects from.
 *
 * `deps` is the sole seam for tests — inject fakes for both network-bound
 * calls without a real Supabase Admin API or Resend call, the same
 * pattern every email-sending module in this app already uses (see
 * sendInvitationEmail's own `deps.sendEmail`).
 */
export async function signup(
  _prevState: AuthActionState,
  formData: FormData,
  deps: SignupDeps = {},
): Promise<AuthActionState> {
  const generateToken = deps.generateToken ?? generateSignupConfirmationToken;
  const sendConfirmationEmail = deps.sendConfirmationEmail ?? sendSignupConfirmationEmail;

  const ip = await getRequestIp();
  const limitCheck = checkRateLimit(SIGNUP_LIMIT, ip);
  if (limitCheck.limited) {
    return { error: limitCheck.message };
  }

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const redirectTo = sanitizeRedirectPath(String(formData.get("redirectTo") ?? ""));

  // Invited-signup defect fix (PR #188), unchanged. Re-validated here
  // independently of the signup page's own display-only lookup — the
  // client's mere claim that an invitationToken exists is never trusted,
  // only used as a lookup key.
  const invitationTokenRaw = String(formData.get("invitationToken") ?? "").trim();
  const invitation = invitationTokenRaw ? await resolveValidSignupInvitation(invitationTokenRaw) : null;

  if (invitationTokenRaw && !invitation) {
    return { error: "This invitation is no longer available. Please refresh and try again." };
  }

  // Invited signups never require (or read) organizationName — there is
  // no organization for this identity to create.
  const organizationName = invitation ? "" : String(formData.get("organizationName") ?? "").trim();

  if (!email || !password || !confirmPassword || (!invitation && !organizationName)) {
    return { error: "All fields are required." };
  }

  if (!EMAIL_PATTERN.test(email)) {
    return { error: "Enter a valid email address." };
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }

  if (password !== confirmPassword) {
    return { error: "Passwords do not match." };
  }

  // organizationName travels through Supabase's own user_metadata only
  // for a standalone signup that ends up needing real email confirmation
  // — src/app/auth/confirm/route.ts's own type=signup branch is the only
  // other place that ever reads it back, once this same identity is
  // re-authenticated in a later, separate request. An invited signup
  // never sets it at all — there is nothing for it to name.
  const tokenResult = await generateToken({
    email,
    password,
    organizationName: invitation ? undefined : organizationName,
  });

  if (!tokenResult.ok) {
    return { error: tokenResult.error };
  }

  if (tokenResult.alreadyConfirmed) {
    // Mirrors the exact "immediate session" UX this app had before this
    // fix, for a project with email confirmation disabled — established
    // synchronously, never by waiting on an email that was never sent.
    const supabase = await createClient();
    const { error: verifyError } = await supabase.auth.verifyOtp({
      type: "signup",
      token_hash: tokenResult.tokenHash,
    });
    if (verifyError) {
      return { error: "Unable to complete signup. Please try again." };
    }

    if (invitation) {
      // Invited-signup defect fix (PR #188), unchanged. Only the identity
      // is established here — getOrCreateOrganizationId() is deliberately
      // never called on this path; acceptInvitationAction() remains the
      // sole authority for granting the actual membership.
      await getOrCreateUser();
      redirect(withToast(sanitizeRedirectPath(`/invite/${invitation.token}`), "Account created"));
    }

    const user = await getOrCreateUser();
    await getOrCreateOrganizationId(user, organizationName);
    redirect(withToast(redirectTo, "Account created"));
  }

  const confirmUrl = buildSignupConfirmationUrl({ tokenHash: tokenResult.tokenHash, invitation });

  const emailResult = await sendConfirmationEmail({
    to: email,
    confirmUrl,
    isInvited: Boolean(invitation),
  });

  if (!emailResult.delivered) {
    // The auth user already exists (unconfirmed) at this point — never
    // claimed as a success. A retried signup for the same email is left
    // to Supabase's own admin.generateLink() semantics for an existing,
    // still-unconfirmed user (see generateSignupConfirmationToken's own
    // doc comment) rather than this action attempting to distinguish
    // "genuine duplicate" from "safe to regenerate" itself.
    return {
      error: "Account could not be created because the confirmation email could not be sent. Please try again.",
    };
  }

  return {
    error: null,
    message: "Account created. Check your email to confirm before signing in.",
  };
}
