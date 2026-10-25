import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { getPlatformLegalConfig } from "@/lib/legal/platform-config";

export const metadata: Metadata = {
  title: "Workspace unavailable",
};

/**
 * Platform Admin Organization Suspension, PR 1. The one destination every
 * suspension denial redirects to (src/lib/organization-access.ts's own
 * ORGANIZATION_UNAVAILABLE_PATH) — deliberately at the top level of the
 * app, a sibling of /privacy and /terms, never nested inside
 * (dashboard)/portal's own route groups: either of those groups' layouts
 * would immediately re-trigger this exact same redirect, an infinite loop.
 *
 * Deliberately static and data-free: no Prisma query, no session read, no
 * dynamic content of any kind — there is nothing here for this page to
 * accidentally leak. It never discloses a suspension reason, timestamp,
 * the acting admin's identity, the organization's own name or id, an
 * invitation token, or any other identifier — the copy below is fixed and
 * generic by design (see the design investigation's own explicit "may
 * suspension/organization existence be disclosed" decision: no).
 *
 * Pre-Auth Redesign, Slice A — the shared shell's own top-right "Sign in"
 * is the one addition to this page's interactivity: a generic, always-
 * true destination that discloses nothing about this specific
 * organization (not a mutation, not a decision about this org at all) —
 * the shell's standard header action on every pre-auth route, not a
 * page-specific exception. Still no form, no mutation control, no
 * suspension-specific link of any kind.
 *
 * Support Email UX Cleanup — "Contact support." used to be plain,
 * unlinked text. Now a real `mailto:` link, sourced from
 * `getPlatformLegalConfig().supportEmail` — the exact same canonical
 * config Privacy's §9 and Terms' §10 already read, never a second,
 * independent support-address source. Same conditional shape those two
 * already establish too: an operator who hasn't configured
 * `PLATFORM_SUPPORT_EMAIL` (and whose `INVITATION_FROM_EMAIL` doesn't
 * resolve to a usable address either — see that function's own fallback
 * chain) sees the identical plain-text sentence this page always had,
 * never a broken `mailto:undefined`/`mailto:null`. Styling matches
 * Privacy/Terms' own mailto link byte-for-byte, not a new pattern.
 */
export default function OrganizationUnavailablePage() {
  const { supportEmail } = getPlatformLegalConfig();

  return (
    <AuthShell cardClassName="max-w-sm" topRightAction={{ label: "Sign in", href: "/login" }}>
      <div className="text-center">
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Workspace unavailable</h1>
        <p className="text-text-secondary mt-2 text-sm">
          {supportEmail ? (
            <>
              This workspace is currently unavailable. Contact support at{" "}
              <a
                href={`mailto:${supportEmail}`}
                className="rounded font-medium text-text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
              >
                {supportEmail}
              </a>
              .
            </>
          ) : (
            "This workspace is currently unavailable. Contact support."
          )}
        </p>
      </div>
    </AuthShell>
  );
}
