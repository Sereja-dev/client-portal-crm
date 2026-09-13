import { redirect } from "next/navigation";
import { sanitizeRedirectPath } from "@/lib/safe-redirect";

/**
 * Staff session-loss audit (read-only architecture review, then this
 * fix). Every Staff guard that discovers, mid-request, that an
 * already-authenticated session is no longer valid
 * (getVerifiedAuthUser() returned no user) routes through this one
 * function instead of a bare `redirect("/login")` — so the login page
 * can tell "your session just expired" apart from an ordinary first
 * visit, and so a returning user lands back where they were instead of
 * on the generic default landing route.
 *
 * Deliberately Staff-only: never imported by Portal code, and never used
 * for an intentional signOut() (that already has nothing worth
 * preserving and keeps its own plain `redirect("/login")`).
 *
 * `currentPath` is supplied only by a caller that already knows its own
 * logical route (a specific page or a Server Action bound to a specific
 * entity's edit route) — never inferred from a request header. The
 * session audit this fix followed from considered and rejected reading
 * a generic "current pathname" off the request (no reliably
 * framework-provided value exists for this at every one of these call
 * sites without inventing a new header-propagation mechanism in
 * middleware, which the audit explicitly left untouched) and rejected
 * trusting `Referer` outright (attacker-controlled, and frequently
 * absent). A generic guard reused by many unrelated routes (the
 * dashboard layout, the platform-admin gate) has no reliable way to
 * recover the specific page being requested, and simply omits
 * `redirectTo` in that case — falling back to the login flow's own
 * existing default landing route — rather than fabricating a path.
 *
 * Reuses `sanitizeRedirectPath()`, the exact same sanitizer the ordinary
 * login flow already runs every `redirectTo` through, so a caller can
 * only ever send a same-origin, internal path here — never an external
 * URL or a protocol-relative one.
 */
export function redirectToLoginForSessionLoss(currentPath?: string): never {
  const params = new URLSearchParams({ reason: "session_expired" });
  if (currentPath) {
    params.set("redirectTo", sanitizeRedirectPath(currentPath));
  }
  redirect(`/login?${params.toString()}`);
}
