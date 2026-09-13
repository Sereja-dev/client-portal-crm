import { redirect } from "next/navigation";
import { sanitizePortalRedirectPath } from "@/lib/safe-redirect";

/**
 * Portal session-loss audit (read-only architecture review, then this
 * fix) — the Portal-only counterpart of
 * src/lib/auth/staff-session-redirect.ts's redirectToLoginForSessionLoss().
 * Every Portal guard that discovers, mid-request, that an
 * already-authenticated Portal session is no longer valid routes through
 * this one function instead of a bare `redirect("/portal/login")` — so
 * the Portal login page can tell "your session just expired" apart from
 * an ordinary first visit, and so a returning Portal user lands back
 * where they were instead of on the generic Portal root.
 *
 * Deliberately Portal-only and structurally independent from the Staff
 * helper: never imports it, never targets `/login`, never uses
 * `sanitizeRedirectPath()`. Reuses `sanitizePortalRedirectPath()` — the
 * exact same sanitizer the ordinary Portal login flow already runs every
 * `redirectTo` through — which both rejects external/protocol-relative
 * URLs (same base protection as the Staff sanitizer) AND additionally
 * confines the result to `/portal` or `/portal/*`, so a Staff route
 * (`/dashboard`) or a Platform Admin route (`/platform-admin`) can never
 * flow through here even though either would be a perfectly normal
 * same-origin path on its own.
 *
 * Never used for an intentional portalSignOut() (that already has
 * nothing worth preserving and keeps its own plain
 * `redirect("/portal/login")`), and never used for the separate
 * "authenticated, but no usable PortalUser identity" branch (a wrong-
 * identity-type denial, not a session expiry).
 *
 * `currentPath` is supplied only by a caller that already knows its own
 * logical Portal route — never inferred from a request header or
 * Referer, same reasoning as the Staff helper's own doc comment. A
 * generic guard reused by many unrelated Portal routes (the `(app)`
 * layout) has no reliable way to recover the specific page being
 * requested, and simply omits `redirectTo` (or passes its own existing
 * safe default) rather than fabricating a path.
 */
export function redirectToPortalLoginForSessionLoss(currentPath?: string): never {
  const params = new URLSearchParams({ reason: "session_expired" });
  if (currentPath) {
    params.set("redirectTo", sanitizePortalRedirectPath(currentPath));
  }
  redirect(`/portal/login?${params.toString()}`);
}
