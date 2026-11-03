/**
 * Platform Admin Organization Suspension, PR 1 (design investigation:
 * PLATFORM_ADMIN_ORGANIZATION_SUSPENSION_DESIGN). The one place the exact
 * meaning of "is this organization suspended" is written down, imported
 * by name at every one of the three independently-confirmed organization-
 * resolution paths (src/lib/current-user.ts's resolveActiveOrganizationId,
 * src/lib/current-portal-user.ts's resolvePortalIdentity,
 * src/lib/search/request-context.ts's getSearchRequestContext) — so a
 * future change to what "suspended" means only ever needs to change here.
 *
 * Deliberately a pure predicate over an already-fetched row, never a
 * function that itself queries — the three call sites already fetch
 * Organization.suspendedAt as part of a query they need for other reasons
 * anyway (a membership/client lookup), so a second, independent query here
 * would be pure waste. Deliberately NOT wrapped in React's cache(): unlike
 * identity resolution (genuinely immutable for one request's lifetime,
 * which is exactly why requirePlatformAdmin()/getVerifiedAuthUser() are
 * cache()-memoized), suspension state can change between requests — a
 * Platform Admin can suspend or reactivate at any moment — so caching it,
 * even within a single request, would risk observing a stale answer.
 *
 * Deliberately just a boolean decision, never a redirect/response of its
 * own: the three real call sites have genuinely different response
 * contracts (a page redirect for staff/Portal vs. a JSON 403 for search —
 * see getSearchRequestContext's own SearchRequestContext type). Forcing
 * one shared redirect-shaped helper across all three would repeat the
 * exact class of hidden-assumption mistake this codebase's own execution-
 * order lesson (PLATFORM_ADMIN_EXECUTION_AUTHORIZATION_AUDIT) already
 * corrected once — each caller applies this decision the way appropriate
 * to its own contract instead.
 *
 * A missing organization (null/undefined) is treated exactly like a
 * suspended one: unusable, so every caller fails closed. Prisma loads a
 * Membership's `organization` relation with a second, separate statement,
 * so an Organization hard-deleted between the two statements surfaces as
 * `membership.organization === null` even though the schema types it as
 * required. Reading `.suspendedAt` off that null used to throw a TypeError
 * mid-request; denying instead is the same decision
 * current-portal-user.ts's getOrganizationSuspensionState() already makes
 * for the same vanished-organization race. This predicate only decides —
 * it never selects another organization, redirects, queries or provisions;
 * a caller that must not fall through to provisioning (see
 * current-user.ts's resolveActiveOrganizationId) tracks that itself.
 *
 * Deliberately does NOT import "server-only": this module has no secret,
 * no cookie/session read, and no database access of its own — a pure
 * predicate over a field name and a fixed route string, safe by
 * construction wherever it's imported. Adding the marker anyway would buy
 * nothing and would incorrectly force every existing caller of
 * current-user.ts (which imports this module) to also mock "server-only"
 * in its own unit tests, breaking several that have no reason to know
 * this module exists.
 */
export function isOrganizationSuspended(organization: { suspendedAt: Date | null } | null | undefined): boolean {
  if (organization == null) {
    return true;
  }
  return organization.suspendedAt !== null;
}

/**
 * The one route every suspended-organization denial redirects to —
 * generic, accessible, discloses nothing (see that page's own doc
 * comment). A single shared constant so the three call sites, and the
 * page itself, can never drift out of sync with each other.
 */
export const ORGANIZATION_UNAVAILABLE_PATH = "/organization-unavailable";
