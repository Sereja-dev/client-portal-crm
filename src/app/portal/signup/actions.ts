"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { withToast } from "@/lib/toast-url";
import { sanitizePortalRedirectPath } from "@/lib/safe-redirect";
import { checkRateLimit, getRequestIp, PORTAL_SIGNUP_LIMIT } from "@/lib/rate-limit";
import { resolveValidPortalSignupInvitation } from "@/lib/invitations/resolve-portal-signup-invitation";
import {
  generateSignupConfirmationToken,
  type GenerateSignupConfirmationTokenFn,
} from "@/lib/auth/signup-confirmation-token";
import { buildPortalSignupConfirmationUrl } from "@/lib/auth/portal-signup-confirm-redirect";
import {
  sendPortalSignupConfirmationEmail,
  type SendPortalSignupConfirmationEmailFn,
} from "@/lib/email/portal-signup-confirmation";
import type { AuthActionState } from "@/types";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export type PortalSignupDeps = {
  generateToken?: GenerateSignupConfirmationTokenFn;
  sendConfirmationEmail?: SendPortalSignupConfirmationEmailFn;
};

/**
 * Portal signup-confirmation defect fix. Deliberately separate from
 * (auth)/signup/actions.ts's `signup`, even though the token-generation
 * call itself is shared (generateSignupConfirmationToken — a generic,
 * Portal-agnostic wrapper around Supabase's Admin API): this action never
 * carries an `organizationName`, never calls getOrCreateOrganizationId(),
 * and never creates a Prisma User, Organization, or Membership row of any
 * kind — a PortalUser is only ever created by acceptClientInvitationAction,
 * once the new account accepts a specific ClientInvitation. This mirrors
 * the exact critical design rule src/app/auth/confirm/route.ts's own
 * portal_signup branch also enforces structurally, not just by
 * convention.
 *
 * No longer calls supabase.auth.signUp() at all — that call's native
 * "Confirm your email address" email (observed directly in a real
 * Production smoke test) depends on Supabase's own hosted verify flow,
 * which this project's (default, unchanged) implicit auth flowType cannot
 * deliver a server-visible token from. generateSignupConfirmationToken()
 * (Admin API `generateLink`) both creates the auth user and returns a
 * real hashed_token — no email is ever sent by Supabase — and this app
 * sends its own branded one via Resend instead.
 */
export async function portalSignup(
  _prevState: AuthActionState,
  formData: FormData,
  deps: PortalSignupDeps = {},
): Promise<AuthActionState> {
  const generateToken = deps.generateToken ?? generateSignupConfirmationToken;
  const sendConfirmationEmail = deps.sendConfirmationEmail ?? sendPortalSignupConfirmationEmail;

  const ip = await getRequestIp();
  const limitCheck = checkRateLimit(PORTAL_SIGNUP_LIMIT, ip);
  if (limitCheck.limited) {
    return { error: limitCheck.message };
  }

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const redirectTo = sanitizePortalRedirectPath(String(formData.get("redirectTo") ?? ""));

  // Portal signup-confirmation defect fix. Re-validated here independently
  // of the signup page's own display-only lookup — the client's mere
  // claim that an invitationToken exists is never trusted, only used as a
  // lookup key. A token that was valid when the page rendered but has
  // since expired/been revoked/been accepted resolves to null here,
  // exactly like an absent one.
  const invitationTokenRaw = String(formData.get("invitationToken") ?? "").trim();
  const invitation = invitationTokenRaw ? await resolveValidPortalSignupInvitation(invitationTokenRaw) : null;

  if (invitationTokenRaw && !invitation) {
    return { error: "This invitation is no longer available. Please refresh and try again." };
  }

  if (!email || !password || !confirmPassword) {
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

  // Never carries organizationName — there is no organization anywhere in
  // the Client Portal identity model.
  const tokenResult = await generateToken({ email, password });

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
      // Only the identity is established here — no PortalUser row is ever
      // created on this path. acceptClientInvitationAction() remains the
      // sole authority for granting Client Portal access.
      redirect(withToast(sanitizePortalRedirectPath(`/portal/invite/${invitation.token}`), "Account created"));
    }

    redirect(withToast(redirectTo, "Account created"));
  }

  const confirmUrl = buildPortalSignupConfirmationUrl({ tokenHash: tokenResult.tokenHash, invitation });

  const emailResult = await sendConfirmationEmail({ to: email, confirmUrl });

  if (!emailResult.delivered) {
    // The auth user already exists (unconfirmed) at this point — never
    // claimed as a success. A retried signup for the same email is left
    // to Supabase's own admin.generateLink() semantics for an existing,
    // still-unconfirmed user, the same posture Staff signup's own fix
    // already takes.
    return {
      error: "Account could not be created because the confirmation email could not be sent. Please try again.",
    };
  }

  return {
    error: null,
    message: "Account created. Check your email to confirm before signing in.",
  };
}
