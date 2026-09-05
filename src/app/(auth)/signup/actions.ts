"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateUser, getOrCreateOrganizationId } from "@/lib/current-user";
import { withToast } from "@/lib/toast-url";
import { sanitizeRedirectPath } from "@/lib/safe-redirect";
import { checkRateLimit, getRequestIp, SIGNUP_LIMIT } from "@/lib/rate-limit";
import { resolveValidSignupInvitation } from "@/lib/invitations/resolve-signup-invitation";
import { buildSignupConfirmRedirectTo } from "@/lib/auth/signup-confirm-redirect";
import type { AuthActionState } from "@/types";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export async function signup(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const ip = await getRequestIp();
  const limitCheck = checkRateLimit(SIGNUP_LIMIT, ip);
  if (limitCheck.limited) {
    return { error: limitCheck.message };
  }

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const redirectTo = sanitizeRedirectPath(String(formData.get("redirectTo") ?? ""));

  // Invited-signup defect fix. Re-validated here independently of the
  // signup page's own display-only lookup — the client's mere claim that
  // an invitationToken exists is never trusted, only used as a lookup key.
  // A token that was valid when the page rendered but has since expired/
  // been revoked/been accepted resolves to null here, exactly like an
  // absent one — see the explicit, distinct error below for that case.
  const invitationTokenRaw = String(formData.get("invitationToken") ?? "").trim();
  const invitation = invitationTokenRaw ? await resolveValidSignupInvitation(invitationTokenRaw) : null;

  if (invitationTokenRaw && !invitation) {
    // The form never rendered an "Organization name" field in this case
    // (the page believed the invitation was valid at render time) — a
    // generic "All fields are required" would be confusing here, since
    // the user has no such field to fill in.
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

  const supabase = await createClient();
  // organizationName travels as user_metadata only for a standalone
  // signup: if Supabase requires email confirmation (no session below),
  // this is the only place it's preserved until the user actually
  // confirms and the *existing* lazy getOrCreateOrganizationId() path
  // (unchanged, called from (dashboard)/layout.tsx on their first real
  // visit) provisions their organization — this app never creates
  // business data for an identity that isn't a real authenticated session
  // yet (see getOrCreateUser()'s own doc comment), so eager creation only
  // happens in the branch below. An invited signup never carries
  // organizationName at all — there is nothing for it to name.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: invitation ? {} : { organizationName },
      emailRedirectTo: buildSignupConfirmRedirectTo(invitation),
    },
  });

  if (error) {
    return { error: error.message };
  }

  if (data.session) {
    // A real session exists immediately (email confirmation disabled/not
    // required for this project).
    if (invitation) {
      // Invited-signup defect fix. Only the identity is established here
      // — getOrCreateUser() ensures the Prisma User row exists, nothing
      // more. getOrCreateOrganizationId() is deliberately never called on
      // this path: this user is about to join an *existing* organization,
      // never a brand-new one they'd own. The actual Membership is only
      // ever created by the existing, already-validated
      // acceptInvitationAction() once this user reaches /invite/<token>
      // again — this preserves that flow's own explicit acceptance model
      // and authorization checks unchanged (email match, expiry, status,
      // role, organization-suspension) rather than auto-accepting here.
      await getOrCreateUser();
      redirect(withToast(sanitizeRedirectPath(`/invite/${invitation.token}`), "Account created"));
    }

    // Standalone signup — provision the tenant synchronously, through the
    // exact same service-layer functions the rest of the app already
    // relies on (getOrCreateUser, getOrCreateOrganizationId), so
    // Organization + OWNER Membership + trial Subscription all exist
    // before the redirect. Onboarding needs no separate row: its progress
    // is always computed live from real data (docs/onboarding-
    // architecture.md), so a fresh Membership already renders the full
    // checklist at 0% the moment /dashboard loads.
    const user = await getOrCreateUser();
    await getOrCreateOrganizationId(user, organizationName);
    redirect(withToast(redirectTo, "Account created"));
  }

  return {
    error: null,
    message: "Account created. Check your email to confirm before signing in.",
  };
}
