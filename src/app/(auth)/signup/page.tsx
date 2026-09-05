import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseSearchParam, type RawSearchParams } from "@/lib/list-params";
import { sanitizeRedirectPath } from "@/lib/safe-redirect";
import { resolveValidSignupInvitation } from "@/lib/invitations/resolve-signup-invitation";
import { AuthCard } from "@/components/auth/auth-card";
import { SignupForm } from "./signup-form";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const redirectTo = sanitizeRedirectPath(parseSearchParam(resolvedSearchParams.redirectTo));

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
    <AuthCard>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight text-gray-900">
        Create an account
      </h1>
      <SignupForm redirectTo={redirectTo} invitation={invitation} />
    </AuthCard>
  );
}
