import { cache } from "react";
import { redirect } from "next/navigation";
import { getVerifiedAuthUser } from "@/lib/supabase/server";
import { redirectToLoginForSessionLoss } from "@/lib/auth/staff-session-redirect";

/**
 * Sale-Ready Phase C. Platform Admin identity is deliberately NOT a
 * `Role` enum value and NOT a `Membership` row — it has to live outside
 * the Organization/Membership graph entirely, the same reasoning
 * `PortalUser` already uses to stay structurally separate from `User`
 * (see the Phase C architecture review). `Membership.role === "OWNER"`
 * means "owns this one customer's workspace"; it says nothing about who
 * operates the SaaS itself, and conflating the two would mean any
 * customer who owns their own org could, in principle, be granted
 * platform authority by the same mechanism — exactly the conflation this
 * module exists to avoid.
 *
 * A comma-separated env var allowlist, not a database table: matches the
 * `src/lib/legal/platform-config.ts` precedent (operator-level facts live
 * in env vars, not the database) exactly, needs no migration, and means
 * changing who holds this power requires a reviewable deploy — a feature,
 * not a limitation, for something this sensitive on a pre-revenue,
 * single-operator product. Revisit as a real table once there's more than
 * one person who should ever have this.
 */
function parseAdminEmails(): Set<string> {
  const raw = process.env.PLATFORM_ADMIN_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isPlatformAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return parseAdminEmails().has(email.trim().toLowerCase());
}

/**
 * The canonical entry point for every Platform Admin request — called
 * from `(platform-admin)/layout.tsx` (same "guard lives in the layout"
 * pattern `(dashboard)/layout.tsx` already establishes for its own
 * portal-identity guard) AND, as of the execution-order correction below,
 * as the literal first awaited statement inside every Platform Admin
 * data-reader entry point (see each reader's own doc comment).
 *
 * PLATFORM_ADMIN_EXECUTION_AUTHORIZATION_AUDIT (PASS_WITH_FINDING) found
 * that a layout redirect protects response delivery only — this repo's
 * installed Next.js 16.3.2 docs confirm layouts and pages render in
 * parallel by default (node_modules/next/dist/docs/01-app/01-getting-
 * started/06-fetching-data.md, "Parallel data fetching"), and that "a
 * layout also does not control whether the rest of the route renders"
 * (.../02-guides/authentication.md, "Layouts and auth checks") — so a
 * child Server Component's own data fetching can start, and complete,
 * before the layout's redirect() ever resolves. Deterministically
 * reproduced: an unauthenticated or non-admin request to a real
 * organization id still executed the full Prisma read, even though the
 * final HTTP response was always a clean redirect with no leaked data.
 *
 * Wrapping this function in React's cache() — the exact DAL pattern
 * .../06-fetching-data.md's "Reusing data with React.cache" section
 * documents ("React.cache is scoped to the current request only. Each
 * request gets its own memoization scope with no sharing between
 * requests") and the exact pattern src/lib/supabase/server.ts's own
 * getVerifiedAuthUser() already established for the same reason — means
 * every one of these repeated calls within one request shares a single
 * real verification, so requiring the guard again inside each reader is
 * free, not redundant work. This changes nothing about *how* the check
 * is performed, only how many times it is repeated per request.
 *
 * Deliberately never calls getCurrentUserOrganization()/getCurrentMembership()
 * — this has no concept of "active organization" at all, and must not
 * gain one; Platform Admin's entire purpose is to read across every
 * organization, which is exactly what those two functions exist to
 * prevent everywhere else in this app.
 *
 * Redirects rather than throwing a visible "access denied" — mirroring
 * (dashboard)/layout.tsx's own silent-redirect discipline for the portal-
 * identity guard, so this route's existence is never confirmed to anyone
 * who isn't already on the allowlist. An authenticated non-admin lands
 * back on their own /dashboard, not on a page that tells them what they
 * were denied.
 */
export const requirePlatformAdmin = cache(async (): Promise<{ email: string }> => {
  const user = await getVerifiedAuthUser();

  if (!user) {
    // Reused by multiple unrelated platform-admin routes with no
    // reliable way to recover which one was actually being requested —
    // see redirectToLoginForSessionLoss()'s own doc comment. This is a
    // genuine lost/expired session; the line below (not-an-admin) is a
    // separate, intentional authorization denial and must stay a plain
    // redirect, not this helper.
    redirectToLoginForSessionLoss();
  }

  if (!isPlatformAdmin(user.email)) {
    redirect("/dashboard");
  }

  return { email: user.email! };
});
