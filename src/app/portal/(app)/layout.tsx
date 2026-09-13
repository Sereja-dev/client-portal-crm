import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { getOptionalPortalUser } from "@/lib/current-portal-user";
import { redirectToPortalLoginForSessionLoss } from "@/lib/auth/portal-session-redirect";
import { isOrganizationSuspended, ORGANIZATION_UNAVAILABLE_PATH } from "@/lib/organization-access";
import { PortalNav } from "@/components/client-portal/portal-nav";
import { portalSignOut } from "./actions";
import { ThemePreferenceReconciler } from "@/components/theme/theme-preference-reconciler";
import { dbThemeModeToRuntimeMode } from "@/lib/theme/db-mode";

// This layout only wraps /portal itself (this route sits in the (app)
// route group nested inside app/portal/ specifically so that /portal/login
// — a sibling, NOT a child of this group — never inherits this guard; a
// portal/layout.tsx placed directly at app/portal/ would also wrap
// /portal/login, and an unauthenticated visitor to the login page would
// bounce straight back into its own redirect.
export default async function PortalAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const identity = await getOptionalPortalUser();

  // Platform Admin Organization Suspension, PR 1: checked again here,
  // before this layout's own header ever renders identity.client.name/
  // identity.portalUser.name/email — defense in depth alongside the
  // execution-level check inside getCurrentPortalUser() every real page
  // under this layout also calls (see that function's own doc comment
  // for why a layout-only check is never treated as sufficient on its
  // own in this codebase). A small, separate, targeted read — the same
  // reasoning getCurrentPortalUser()'s own local helper documents.
  if (identity) {
    const organization = await prisma.organization.findUnique({
      where: { id: identity.organizationId },
      select: { suspendedAt: true },
    });
    if (isOrganizationSuspended(organization ?? { suspendedAt: new Date(0) })) {
      redirect(ORGANIZATION_UNAVAILABLE_PATH);
    }
  }

  if (!identity) {
    const supabase = await createClient();
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();

    if (!authUser) {
      // Genuine lost/expired session — no reliable way to recover the
      // specific nested route being requested here (same reasoning as
      // the Staff dashboard layout's own guard; see
      // redirectToPortalLoginForSessionLoss()'s doc comment), so this
      // keeps its existing safe fallback of "/portal" while gaining
      // reason=session_expired.
      redirectToPortalLoginForSessionLoss("/portal");
    }

    // A session exists but there's no usable PortalUser for it. If this
    // identity is actually staff, send them to their real home instead of
    // a portal login they could never use — never auto-create anything
    // for them here either way.
    const hasMembership = await prisma.membership.findFirst({
      where: { userId: authUser.id },
      select: { id: true },
    });
    if (hasMembership) {
      redirect("/dashboard");
    }

    redirect("/portal/login");
  }

  return (
    // Portal Redesign Batch 1 — bg-gray-50 replaced with bg-surface-recessed,
    // the same "page gutter" token the staff (dashboard) layout's own outer
    // wrapper already uses (Design System page migration Batch 2) — keeps
    // this shell visually continuous with the rest of the Aqenra system
    // rather than introducing a second, Portal-only gutter tone.
    <div className="bg-surface-recessed min-h-screen">
      {/*
        Aqenra Theme Persistence Phase C2 — same reconciliation as the
        staff (dashboard) layout, using identity.portalUser.themeMode.
        getOptionalPortalUser() -> resolvePortalIdentity() already
        returns the full PortalUser row (no `select`), so this is zero
        extra queries.
      */}
      <ThemePreferenceReconciler mode={dbThemeModeToRuntimeMode(identity.portalUser.themeMode)} />
      <header className="border-border-default bg-surface border-b">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          {/* min-w-0: lets this group actually shrink below its content's
              intrinsic width when the header wraps on a narrow viewport —
              flex items default to min-width: auto, which would otherwise
              silently block the client-name truncate below from ever
              taking effect (the same header-overflow cause already fixed
              this way in the staff Header). */}
          <div className="min-w-0">
            <p className="text-text-muted text-xs font-medium tracking-wide uppercase">Client Portal</p>
            <p className="text-text-primary truncate text-sm font-semibold" title={identity.client.name}>
              {identity.client.name}
            </p>
          </div>
          <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0 text-right text-sm">
              <p className="text-text-primary truncate" title={identity.portalUser.name}>
                {identity.portalUser.name}
              </p>
              <p className="text-text-muted truncate text-xs" title={identity.portalUser.email}>
                {identity.portalUser.email}
              </p>
            </div>
            <form action={portalSignOut} className="shrink-0">
              <button
                type="submit"
                className="border-border-strong text-text-secondary focus-visible:ring-focus-ring rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
        <div className="mx-auto max-w-5xl">
          <PortalNav />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
