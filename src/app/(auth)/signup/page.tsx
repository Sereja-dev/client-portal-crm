import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseSearchParam, type RawSearchParams } from "@/lib/list-params";
import { sanitizeRedirectPath } from "@/lib/safe-redirect";
import { resolveValidSignupInvitation } from "@/lib/invitations/resolve-signup-invitation";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignupForm } from "./signup-form";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const redirectTo = sanitizeRedirectPath(parseSearchParam(resolvedSearchParams.redirectTo));

  // Signup-confirmation feedback fix — set only by /auth/confirm's own
  // type=signup branch when the token is missing, invalid, expired, or
  // already used (src/app/auth/confirm/route.ts's handleSignupConfirm),
  // never by an ordinary visit to this page, so a plain "/signup" never
  // shows this message — same convention as this page's own sibling
  // /login page's `sessionExpired`.
  const invalidConfirmationLink = parseSearchParam(resolvedSearchParams.invalid) === "1";

  // Invited-signup defect fix. A display-only lookup — re-validated
  // independently (and authoritatively) inside signup() itself before
  // anything is ever created; a forged/expired/wrong token here simply
  // renders the normal standalone form, never a distinguishable error.
  const invitationTokenParam = parseSearchParam(resolvedSearchParams.invitationToken);
  const invitation = invitationTokenParam
    ? await resolveValidSignupInvitation(invitationTokenParam)
    : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect(redirectTo);
  }

  return (
    <AuthShell
      cardClassName="max-w-[520px]"
      topRightAction={{
        label: "Sign in",
        href: redirectTo ? `/login?redirectTo=${encodeURIComponent(redirectTo)}` : "/login",
      }}
      showSupportWidget
    >
      <h1 className="mb-6 text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl">
        Create an account
      </h1>
      {invalidConfirmationLink && (
        // Recovery-guidance correction: leads with Support (a verified
        // path — this exact widget, opened from this exact page,
        // completes a real submission in test/e2e/pre-auth-redesign.spec.ts's
        // own "a fully valid submission succeeds..." case) rather than
        // asserting that resubmitting the form below will itself succeed,
        // which was never verified against Supabase's real retry
        // behavior for an existing, still-unconfirmed signup.
        <p className="border-warning bg-warning-subtle text-warning mb-4 rounded-md border px-3 py-2 text-sm">
          That confirmation link is invalid or has expired. Contact Support for help, or you can try signing up
          again below.
        </p>
      )}
      <SignupForm redirectTo={redirectTo} invitation={invitation} />
    </AuthShell>
  );
}
