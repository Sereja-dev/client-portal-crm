"use client";

import { useErrorBoundaryLogging } from "@/components/ui/segment-error-state";
import { Button } from "@/components/ui/button";

/**
 * Reports Phase 2. Only ever reached for a genuine, unexpected failure —
 * the "access denied" state is handled inline by page.tsx itself, before
 * any error would reach this boundary (see that file's own doc comment).
 * Mirrors src/app/(dashboard)/analytics/error.tsx's own identical shape;
 * never exposes a raw error message/stack.
 */
export default function ReportsError({
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
        <h2 className="text-text-primary text-lg font-semibold">Reports is unavailable right now</h2>
        <p className="text-text-secondary mt-2 max-w-sm text-sm">We couldn&apos;t load your reports data. Please try again.</p>
        <Button type="button" onClick={() => reset()} className="mt-4">
          Try again
        </Button>
      </div>
    </div>
  );
}
