"use client";

import { useActionState } from "react";
import Link from "next/link";
import { portalSignup } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormLabel } from "@/components/ui/form-field";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import type { ValidPortalSignupInvitation } from "@/lib/invitations/resolve-portal-signup-invitation";
import type { AuthActionState } from "@/types";

const initialState: AuthActionState = { error: null };

export function PortalSignupForm({
  redirectTo,
  invitation,
}: {
  redirectTo?: string;
  /**
   * Portal signup-confirmation defect fix. Already server-validated by
   * the page component — this form only ever renders/submits what it's
   * given, it never re-derives or re-checks validity itself. When
   * present: the email field is pre-filled and locked to the invited
   * address (acceptance still strictly re-validates the email match
   * afterward — this is a UX convenience, not the security boundary),
   * and the invitation token travels forward as its own hidden field for
   * portalSignup() to independently re-validate.
   */
  invitation?: ValidPortalSignupInvitation | null;
}) {
  const [state, formAction, pending] = useActionState(portalSignup, initialState);

  return (
    <form action={formAction} className="space-y-4">
      {redirectTo && <input type="hidden" name="redirectTo" value={redirectTo} />}
      {invitation && <input type="hidden" name="invitationToken" value={invitation.token} />}

      {invitation && (
        <p className="text-text-muted text-sm">
          You&apos;re creating an account for{" "}
          <span className="text-text-primary font-medium">{invitation.clientName}</span>&apos;s
          Client Portal invitation.
        </p>
      )}

      <div>
        <FormLabel htmlFor="email" required>
          Email
        </FormLabel>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={invitation?.email}
          readOnly={Boolean(invitation)}
        />
      </div>

      <div>
        <FormLabel htmlFor="password" required>
          Password
        </FormLabel>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
        />
      </div>

      <div>
        <FormLabel htmlFor="confirmPassword" required>
          Confirm password
        </FormLabel>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
        />
      </div>

      {state.error && (
        <p role="alert" className="text-danger text-sm">
          {state.error}
        </p>
      )}

      {state.message && (
        <p role="status" className="text-success text-sm">
          {state.message}
        </p>
      )}

      <p className="text-text-muted text-center text-xs">
        By creating an account, you agree to our{" "}
        <Link href="/terms" className={ACTION_LINK_CLASSES}>
          Terms of Service
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className={ACTION_LINK_CLASSES}>
          Privacy Policy
        </Link>
        .
      </p>

      <Button type="submit" loading={pending} className="w-full">
        {pending ? "Creating account…" : "Sign up"}
      </Button>

      <p className="text-text-muted text-center text-sm">
        Already have an account?{" "}
        <Link
          href={redirectTo ? `/portal/login?redirectTo=${encodeURIComponent(redirectTo)}` : "/portal/login"}
          className={ACTION_LINK_CLASSES}
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
