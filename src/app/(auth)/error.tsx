"use client";

import { useErrorBoundaryLogging } from "@/components/ui/segment-error-state";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";

/**
 * Pre-Auth Redesign, Slice A — same fixed dark shell as every other
 * pre-auth route. Still exposes no internal error detail of any kind
 * (no error.message, no digest) — unchanged from before this file's own
 * visual migration.
 */
export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useErrorBoundaryLogging(error);

  return (
    <AuthShell cardClassName="max-w-sm" topRightAction={{ label: "Sign in", href: "/login" }}>
      <div className="text-center">
        <h1 className="text-text-primary text-lg font-semibold">Something went wrong</h1>
        <p className="text-text-secondary mt-2 text-sm">Please try again.</p>
        <Button type="button" onClick={() => reset()} className="mt-6 w-full">
          Try again
        </Button>
      </div>
    </AuthShell>
  );
}
