import Link from "next/link";
import { getPlatformCopyrightLine } from "@/lib/legal/platform-config";

const LINK_CLASSES =
  "focus-visible:ring-focus-ring hover:text-text-primary rounded hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

/**
 * Rendered once, globally, in the root layout — see src/app/layout.tsx.
 * There is no shared layout across the app's various auth pages
 * (login/signup/forgot-password, both staff and portal variants), so a
 * single root-level footer is the only way to cover every route with one
 * change, the same reasoning ToastProvider/ToastListener already use for
 * their own global, root-level placement.
 *
 * Pre-Auth Redesign, Slice A — an earlier version of this fix made this
 * component "use client" + `usePathname()`-aware so it could render dark
 * on the new fixed-dark pre-auth routes. Reverted: that approach caused a
 * genuine React hydration-mismatch (#418) on every DYNAMIC pre-auth route
 * (confirmed by direct reproduction — forcing `/organization-unavailable`
 * dynamic alone reproduced the identical failure with none of Login's own
 * content present), which in turn reverted the pre-paint script's already-
 * correct `data-theme` back to the SSR default. Root cause understood at
 * the level of "a Client Component calling usePathname() in exactly this
 * root-layout position, on a dynamic route, hydrates unreliably here" —
 * not chased further into Next.js's own internals once a reproducible,
 * zero-client-JS alternative was available. This component is back to a
 * plain Server Component, byte-for-byte its pre-redesign behavior; see
 * globals.css's own `body:has(.auth-shell) footer` rule for how the
 * fixed-dark pre-auth routes now hide this global footer instead (pure
 * CSS, no pathname detection, no hydration risk) — AuthShell renders its
 * own self-contained dark Privacy/Terms footer in its place.
 */
export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-border-default bg-surface border-t">
      <div className="text-text-muted mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4 text-xs sm:px-6">
        <p>{getPlatformCopyrightLine(year)}</p>
        <nav className="flex gap-4">
          <Link href="/privacy" className={LINK_CLASSES}>
            Privacy Policy
          </Link>
          <Link href="/terms" className={LINK_CLASSES}>
            Terms of Service
          </Link>
          <Link href="/cookies" className={LINK_CLASSES}>
            Cookie Policy
          </Link>
        </nav>
      </div>
    </footer>
  );
}
