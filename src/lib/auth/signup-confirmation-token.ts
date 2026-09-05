import "server-only";
import { getSupabaseAuthAdminClient } from "@/lib/supabase/admin-client";

/**
 * Signup-confirmation defect fix (Invited Signup Confirmation Redirect
 * Investigation). Generates a signup confirmation token server-side via
 * Supabase's Admin API — `admin.generateLink({ type: "signup", ... })`
 * both creates the auth user AND returns its `hashed_token` (confirmed
 * directly from the installed `@supabase/auth-js` types: "generateLink()
 * handles the creation of the user for signup, invite and magiclink") —
 * without Supabase ever sending its own native confirmation email. This
 * app sends its own branded one instead (src/lib/email/signup-
 * confirmation.ts), the same "own the whole link, never depend on
 * Supabase's own template/flow-type semantics" discipline
 * src/lib/auth/recovery-token.ts's generateRecoveryToken() already
 * established for password reset.
 *
 * `alreadyConfirmed` mirrors the exact real field the installed SDK
 * documents on the returned `user` object (`email_confirmed_at`/
 * `confirmed_at`) — when a project has email confirmation disabled, a
 * freshly-created user is confirmed immediately, letting the caller
 * establish a real session synchronously (via its own verifyOtp() call)
 * instead of ever sending an email — this is what preserves the
 * pre-existing "immediate session, no confirmation needed" UX exactly,
 * without ever depending on supabase.auth.signUp()'s own native email
 * side effect (which cannot be suppressed while still using signUp()
 * itself, and is the entire root cause this fix closes).
 *
 * `organizationName`, when present, travels through Supabase's own
 * `user_metadata` (`options.data`) — the one durable place it can survive
 * the gap between form submission and a *separate*, later confirmation
 * request (see src/app/auth/confirm/route.ts's own type=signup branch,
 * which is the only other place that ever reads it back). Never present
 * for an invitation-originated signup — there is no organization for it
 * to name.
 */

export type GenerateSignupConfirmationTokenResult =
  | { ok: true; tokenHash: string; alreadyConfirmed: boolean }
  | { ok: false; error: string };

export type GenerateSignupConfirmationTokenFn = (params: {
  email: string;
  password: string;
  organizationName?: string;
}) => Promise<GenerateSignupConfirmationTokenResult>;

const GENERIC_ERROR = "Unable to create your account. Please try again.";

export const generateSignupConfirmationToken: GenerateSignupConfirmationTokenFn = async (params) => {
  try {
    const admin = getSupabaseAuthAdminClient();
    // `options.redirectTo`/the response's own `action_link`/`redirect_to`/
    // `email_otp` are deliberately never set or read — this app builds its
    // own complete confirmation URL from `hashed_token` alone (see
    // src/lib/auth/signup-confirm-redirect.ts's buildSignupConfirmationUrl),
    // the same "never depend on Supabase's own constructed link" posture
    // recovery-token.ts's generateRecoveryToken() already established.
    const { data, error } = await admin.auth.admin.generateLink({
      type: "signup",
      email: params.email,
      password: params.password,
      options: params.organizationName ? { data: { organizationName: params.organizationName } } : undefined,
    });

    if (error || !data?.properties?.hashed_token || !data.user) {
      // Passes through Supabase's own message (e.g. "User already
      // registered") — the same disclosure posture standalone signup's
      // own supabase.auth.signUp() error handling already had before this
      // fix; unlike password reset, signup has never hidden this to
      // prevent enumeration (the form itself already reveals "this email
      // exists" through this exact error).
      return { ok: false, error: error?.message ?? GENERIC_ERROR };
    }

    return {
      ok: true,
      tokenHash: data.properties.hashed_token,
      alreadyConfirmed: Boolean(data.user.email_confirmed_at ?? data.user.confirmed_at),
    };
  } catch {
    return { ok: false, error: GENERIC_ERROR };
  }
};
