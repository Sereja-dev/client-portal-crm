"use client";

import { useActionState } from "react";
import Link from "next/link";
import { login } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormLabel } from "@/components/ui/form-field";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import type { AuthActionState } from "@/types";

const initialState: AuthActionState = { error: null };

export function LoginForm({ redirectTo }: { redirectTo?: string }) {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <form action={formAction} className="space-y-4">
      {redirectTo && <input type="hidden" name="redirectTo" value={redirectTo} />}
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
        />
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <FormLabel htmlFor="password" required>
            Password
          </FormLabel>
          <Link href="/forgot-password" className={ACTION_LINK_CLASSES}>
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
        <p role="alert" className="text-danger text-sm">
          {state.error}
        </p>
      )}

      <Button type="submit" loading={pending} className="w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>

      <p className="text-text-secondary text-center text-sm">
        Don&apos;t have an account?{" "}
        <Link
          href={redirectTo ? `/signup?redirectTo=${encodeURIComponent(redirectTo)}` : "/signup"}
          className={ACTION_LINK_CLASSES}
        >
          Create account
        </Link>
      </p>
    </form>
  );
}
