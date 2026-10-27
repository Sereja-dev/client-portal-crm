import type { ReactNode } from "react";
import Link from "next/link";
import { siteConfig } from "@/config/site";
import { getPlatformLegalConfig } from "@/lib/legal/platform-config";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { AqenraMarkIcon } from "@/components/ui/icons";

const FOOTER_LINK_CLASSES =
  "focus-visible:ring-focus-ring hover:text-text-primary rounded hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

/**
 * Pre-Auth Redesign, Slice A — replaces the previous `AuthCard`. Every
 * Staff pre-auth route (`/`, `/login`, `/signup`, `/forgot-password`,
 * `/reset-password`, `/invite/[id]`, `/organization-unavailable`, the
 * `(auth)` error fallback) now shares this one shell instead of each
 * hand-rolling its own `<main>` wrapper (the previous `AuthCard`'s four
 * consumers) or still carrying pre-design-system literal gray/black
 * classes (the other four routes, never migrated at all).
 *
 * Product decision (not this component's own choice): pre-auth is a
 * FIXED dark surface, independent of the authenticated app's own
 * Light/Dark/System preference — see globals.css's own `.auth-shell`
 * doc comment for the token-shadowing mechanism this relies on (every
 * existing semantic-token Tailwind utility — bg-surface, text-text-
 * primary, border-border-default, etc. — resolves correctly here with
 * zero per-component change, because `.auth-shell` locally overrides
 * the same CSS custom properties those utilities already read through
 * `@theme inline`). The authenticated Dashboard's own theme system, and
 * Portal's entirely separate auth pages, are untouched by this file.
 *
 * Deliberately owns ONLY page chrome — background/gradient, the top
 * brand+contextual-action header, centered card placement, responsive
 * outer spacing. It never owns form fields, validation, submission, or
 * success/error state — those stay exactly where they already were
 * (each page's own form component), so Portal's two shared form
 * components (ForgotPasswordForm/ResetPasswordForm) never need to know
 * this shell exists.
 */
export function AuthShell({
  topRightAction,
  cardClassName = "max-w-[480px]",
  children,
}: {
  /** The one page-header action every route needs its own honest answer for — omitted entirely when no truthful destination exists for the current state (e.g. an already-authenticated invite viewer). */
  topRightAction?: { label: string; href: string };
  /** Card width varies deliberately by route content (a short "invalid link" message vs. a four-field signup form) — see the Visual Spec's own "560-680px depending on route" note. Defaults to the common single-column form width. */
  cardClassName?: string;
  children: ReactNode;
}) {
  const legalConfig = getPlatformLegalConfig();
  const year = new Date().getFullYear();

  return (
    <div className="auth-shell auth-shell-page relative flex min-h-screen flex-col">
      <header className="relative z-10 flex items-center justify-between gap-4 px-4 py-5 sm:px-8 sm:py-6">
        <Link
          href="/"
          className="focus-visible:ring-focus-ring flex items-center gap-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        >
          <AqenraMarkIcon className="h-7 w-7 shrink-0" />
          <span className="text-text-primary text-lg font-semibold tracking-tight">{siteConfig.name}</span>
        </Link>
        {topRightAction && (
          <Link
            href={topRightAction.href}
            className="border-border-strong text-text-primary focus-visible:ring-focus-ring hover:bg-[var(--hover)] shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          >
            {topRightAction.label}
          </Link>
        )}
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-8 sm:px-6">
        <div className={`w-full ${cardClassName}`}>
          <div className={`p-8 shadow-sm sm:p-10 ${CARD_SURFACE_CLASSES}`}>{children}</div>
        </div>
      </main>

      {/*
        Self-contained, local — the global root-layout Footer hides
        itself on this exact subtree instead (globals.css's own
        `body:has(.auth-shell) footer` rule), so this is the only legal
        footer that ever renders here, never a duplicate. The
        `auth-shell-footer` class is load-bearing: that same CSS rule
        would otherwise also match THIS footer (it's a `footer`
        descendant of a body that has `.auth-shell` in it too) and hide
        it along with the global one — the class is how the rule tells
        the two apart.
      */}
      <footer className="auth-shell-footer border-border-subtle relative z-10 border-t px-4 py-4 sm:px-8">
        <div className="text-text-muted mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 text-xs">
          <p>
            © {year} {legalConfig.legalName}
          </p>
          <nav className="flex gap-4">
            <Link href="/privacy" className={FOOTER_LINK_CLASSES}>
              Privacy Policy
            </Link>
            <Link href="/terms" className={FOOTER_LINK_CLASSES}>
              Terms of Service
            </Link>
            <Link href="/cookies" className={FOOTER_LINK_CLASSES}>
              Cookie Policy
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
