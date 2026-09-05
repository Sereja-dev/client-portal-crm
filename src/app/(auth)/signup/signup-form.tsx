"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signup } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormLabel } from "@/components/ui/form-field";
import type { ValidSignupInvitation } from "@/lib/invitations/resolve-signup-invitation";
import type { AuthActionState } from "@/types";

const initialState: AuthActionState = { error: null };

export function SignupForm({
  redirectTo,
  invitation,
}: {
  redirectTo?: string;
  /**
   * Invited-signup defect fix. Already server-validated by the page
   * component — this form only ever renders/submits what it's given, it
   * never re-derives or re-checks validity itself. When present: no
   * "Organization name" field is rendered or required (an invited Member
   * must never be asked to create a workspace), the email field is
   * pre-filled and locked to the invited address (acceptance still
   * strictly re-validates the email match afterward — this is a UX
   * convenience, not the security boundary), and the invitation token
   * travels forward as its own hidden field for signup() to independently
   * re-validate.
   */
  invitation?: ValidSignupInvitation | null;
}) {
  const [state, formAction, pending] = useActionState(signup, initialState);

  return (
    <form action={formAction} className="space-y-4">
      {redirectTo && <input type="hidden" name="redirectTo" value={redirectTo} />}
      {invitation && <input type="hidden" name="invitationToken" value={invitation.token} />}

      {invitation ? (
        <p className="text-sm text-gray-600">
          You&apos;re joining{" "}
          <span className="font-medium text-gray-900">{invitation.organizationName}</span>.
        </p>
      ) : (
        <div>
          <FormLabel htmlFor="organizationName" required>
            Organization name
          </FormLabel>
          <Input
            id="organizationName"
            name="organizationName"
            type="text"
            autoComplete="organization"
            placeholder="Acme Inc."
            required
          />
        </div>
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
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}

      {state.message && (
        <p role="status" className="text-sm text-green-600">
          {state.message}
        </p>
      )}

      <p className="text-center text-xs text-gray-500">
        By creating an account, you agree to our{" "}
        <Link href="/terms" className="rounded font-medium text-black hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2">
          Terms of Service
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="rounded font-medium text-black hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2">
          Privacy Policy
        </Link>
        .
      </p>

      <Button type="submit" loading={pending} className="w-full">
        {pending ? "Creating account…" : "Sign up"}
      </Button>

      <p className="text-center text-sm text-gray-600">
        Already have an account?{" "}
        <Link
          href={redirectTo ? `/login?redirectTo=${encodeURIComponent(redirectTo)}` : "/login"}
          className="rounded font-medium text-black hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
