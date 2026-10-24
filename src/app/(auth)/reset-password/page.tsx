import Link from "next/link";
import { getVerifiedAuthUser } from "@/lib/supabase/server";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { resetPassword, signOutAndGoToLogin } from "./actions";

/**
 * Sale-Ready Phase B, PR1 (Password Recovery). Reached only via /auth/
 * confirm after a token verifies — a real Supabase session (or, in
 * TEST_MODE, the identity-cookie bypass) must already exist by the time
 * this renders. No session at all — expired token, invalid token, a
 * direct visit with no link ever clicked — all collapse to the exact same
 * friendly view; the difference is never surfaced, the same "don't leak
 * more than the generic outcome" reasoning the forgot-password request
 * itself already follows.
 */
export default async function ResetPasswordPage() {
  const user = await getVerifiedAuthUser();

  return (
    <AuthShell topRightAction={{ label: "Back to sign in", href: "/login" }}>
      {user ? (
        <>
          <h1 className="mb-6 text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl">
            Set a new password
          </h1>
          <ResetPasswordForm action={resetPassword} signOutAction={signOutAndGoToLogin} />
        </>
      ) : (
        <div className="space-y-4 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">This link is invalid or has expired</h1>
          <p className="text-text-secondary text-sm">Request a new password reset link to continue.</p>
          <p className="text-sm">
            <Link href="/forgot-password" className={ACTION_LINK_CLASSES}>
              Request a new link
            </Link>
          </p>
        </div>
      )}
    </AuthShell>
  );
}
