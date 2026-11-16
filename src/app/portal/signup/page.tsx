import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseSearchParam, type RawSearchParams } from "@/lib/list-params";
import { sanitizePortalRedirectPath } from "@/lib/safe-redirect";
import { resolveValidPortalSignupInvitation } from "@/lib/invitations/resolve-portal-signup-invitation";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { PortalSignupForm } from "./portal-signup-form";

export default async function PortalSignupPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const redirectTo = sanitizePortalRedirectPath(parseSearchParam(resolvedSearchParams.redirectTo));

  // Signup-confirmation feedback fix — set only by /auth/confirm's own
  // type=portal_signup branch when the token is missing, invalid,
  // expired, or already used (src/app/auth/confirm/route.ts's
  // handlePortalSignupConfirm), never by an ordinary visit to this page,
  // so a plain "/portal/signup" never shows this message — same
  // convention as /portal/login's own `sessionExpired`.
  const invalidConfirmationLink = parseSearchParam(resolvedSearchParams.invalid) === "1";

  // Portal signup-confirmation defect fix. A display-only lookup —
  // re-validated independently (and authoritatively) inside
  // portalSignup() itself before anything is ever created; a forged/
  // expired/wrong token here simply renders the normal standalone form,
  // never a distinguishable error.
  const invitationTokenParam = parseSearchParam(resolvedSearchParams.invitationToken);
  const invitation = invitationTokenParam
    ? await resolveValidPortalSignupInvitation(invitationTokenParam)
    : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Already authenticated (staff or portal identity alike) — redirectTo's
  // own /portal-only sanitization means this never sends a staff session
  // toward /dashboard from here; the /portal layout's own guard handles
  // routing a staff-only identity onward from there if needed.
  if (user) {
    redirect(redirectTo);
  }

  return (
    <main className="bg-surface-recessed flex min-h-screen items-center justify-center px-4">
      <div className={`w-full max-w-sm p-8 shadow-sm ${CARD_SURFACE_CLASSES}`}>
        <h1 className="text-text-primary mb-6 text-2xl font-semibold tracking-tight">
          Create your Client Portal account
        </h1>
        {invalidConfirmationLink && (
          // Recovery-guidance correction: the only real path into this
          // page is a real invitation link from /portal/invite/[token]
          // (confirmed: no other UI anywhere links to /portal/signup
          // without an invitationToken) — so the inviting company, not
          // Aqenra, is the verified party who can issue a fresh
          // invitation. This never claims Aqenra will resend anything,
          // and no longer asserts that resubmitting the form below will
          // itself succeed, which was never verified against Supabase's
          // real retry behavior for an existing, still-unconfirmed
          // signup.
          <p className="border-warning bg-warning-subtle text-warning mb-4 rounded-md border px-3 py-2 text-sm">
            That confirmation link is invalid or has expired. Contact the company that invited you to request a
            new invitation, or you can try again below.
          </p>
        )}
        <PortalSignupForm redirectTo={redirectTo} invitation={invitation} />
      </div>
    </main>
  );
}
