"use client";

import { useActionState } from "react";
import Link from "next/link";
import { portalLogin } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormLabel, FormErrorMessage } from "@/components/ui/form-field";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import type { AuthActionState } from "@/types";

const initialState: AuthActionState = { error: null };

// Deliberately no "Sign up" link — a Client Portal identity is only ever
// created by accepting a ClientInvitation, never a self-serve signup.
export function PortalLoginForm({ redirectTo }: { redirectTo: string }) {
  const [state, formAction, pending] = useActionState(portalLogin, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <div>
        <FormLabel htmlFor="email" required>
          Email
        </FormLabel>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <FormLabel htmlFor="password" required>
            Password
          </FormLabel>
          <Link href="/portal/forgot-password" className={ACTION_LINK_CLASSES}>
            Forgot password?
          </Link>
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>

      {state.error && (
        <FormErrorMessage className="text-sm">
          {state.error}
        </FormErrorMessage>
      )}

      <Button type="submit" loading={pending} className="w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
