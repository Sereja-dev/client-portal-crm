"use client";

import { useErrorBoundaryLogging } from "@/components/ui/segment-error-state";

/**
 * Sky-Blue/Grayscale Theme Redesign V1 (correction pass) — this file
 * replaces the root layout entirely (Next.js's own `global-error`
 * convention: it renders its own `<html>/<body>`, the one deliberate
 * exception left untouched when the rest of the app migrated to the
 * semantic token system), so it stays dependency-free on purpose — a
 * last-resort safety page should not assume anything else in the app
 * (including the token stylesheet) is still working. Its own Tailwind
 * "gray" classes were still cool-tinted (rgb channels unequal), not the
 * literal grayscale the owner's own direction requires; fixed here to
 * Tailwind's true-achromatic "neutral" scale (same lightness steps,
 * zero hue) — still a plain, self-contained utility class, no CSS
 * custom property involved.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useErrorBoundaryLogging(error);

  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-4 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
            Something went wrong
          </h1>
          <p className="mt-2 max-w-sm text-sm text-neutral-600">
            An unexpected error occurred. Please try again.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            className="mt-6 rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
