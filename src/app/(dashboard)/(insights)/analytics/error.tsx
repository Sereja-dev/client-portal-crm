"use client";

import { useErrorBoundaryLogging } from "@/components/ui/segment-error-state";
import { Button } from "@/components/ui/button";

/**
 * Analytics Stage 2. Only ever reached for a genuine, unexpected failure
 * (a real "unavailable data" case — e.g. a database error) — the
 * "access denied" state is handled inline by page.tsx itself, before any
 * error would reach this boundary (see that file's own doc comment for
 * why). Mirrors src/app/(dashboard)/error.tsx's own shape.
 */
export default function AnalyticsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useErrorBoundaryLogging(error);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="border-border-strong bg-surface flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
        <h2 className="text-text-primary text-lg font-semibold">Analytics is unavailable right now</h2>
        <p className="text-text-secondary mt-2 max-w-sm text-sm">We couldn&apos;t load your analytics data. Please try again.</p>
        <Button type="button" onClick={() => reset()} className="mt-4">
          Try again
        </Button>
      </div>
    </div>
  );
}
