import Link from "next/link";

/**
 * Sky-Blue/Grayscale Theme Redesign V1 (correction pass) — this page
 * renders inside the normal root layout (unlike global-error.tsx, which
 * replaces it and deliberately stays dependency-free) but had never
 * adopted the shared semantic tokens, instead hand-rolling Tailwind's
 * cool-tinted "gray" scale directly — found during the owner's own
 * "inventory ALL app-owned light-theme... hardcoded styles" audit.
 */
export default function NotFound() {
  return (
    <div className="bg-surface-recessed flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <p className="text-text-muted text-sm font-medium">404</p>
      <h1 className="text-text-primary mt-2 text-2xl font-semibold tracking-tight">
        Page not found
      </h1>
      <p className="text-text-secondary mt-2 max-w-sm text-sm">
        The page you&apos;re looking for doesn&apos;t exist, or may belong to
        a different account.
      </p>
      <Link
        href="/dashboard"
        className="bg-accent hover:bg-accent-hover focus-visible:ring-focus-ring mt-6 rounded-md px-4 py-2 text-sm font-medium text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      >
        Go to dashboard
      </Link>
    </div>
  );
}
