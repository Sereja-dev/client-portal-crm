import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import type { PortalUser, Client } from "@/generated/prisma/client";
import type { User as SupabaseAuthUser } from "@supabase/supabase-js";
import { isOrganizationSuspended, ORGANIZATION_UNAVAILABLE_PATH } from "@/lib/organization-access";
import { redirectToPortalLoginForSessionLoss } from "@/lib/auth/portal-session-redirect";

export type CurrentPortalUser = {
  authUser: SupabaseAuthUser;
  portalUser: PortalUser;
  client: Client;
  clientId: string;
  /** Client.organizationId, guaranteed non-null here — see getOptionalPortalUser(). */
  organizationId: string;
};

/**
 * Resolves the PortalUser row (if any) for the given Supabase auth user,
 * together with its Client. Returns null — never redirects — for every
 * failure case: no PortalUser row, or a PortalUser whose Client has no
 * organization (a Client with organizationId = null can't be safely scoped,
 * so access is refused rather than guessed at).
 */
async function resolvePortalIdentity(
  authUser: SupabaseAuthUser,
): Promise<CurrentPortalUser | null> {
  const portalUser = await prisma.portalUser.findUnique({
    where: { id: authUser.id },
    include: { client: true },
  });

  if (!portalUser || !portalUser.client.organizationId) {
    return null;
  }

  return {
    authUser,
    portalUser,
    client: portalUser.client,
    clientId: portalUser.clientId,
    organizationId: portalUser.client.organizationId,
  };
}

/**
 * Strict variant for use inside already-gated portal pages: resolves the
 * current Client Portal identity or redirects to /portal/login. Never
 * calls getOrCreateUser(), never creates a User, Organization, or
 * PortalUser — a PortalUser row (with a Client that has an organization)
 * must already exist, or this refuses access rather than provisioning
 * anything. organizationId/clientId are always derived from this lookup,
 * never accepted from a cookie or query string — there is no "active
 * organization" concept for a portal identity at all.
 *
 * Platform Admin Organization Suspension, PR 1: a Client Portal identity
 * has exactly one organization (via its Client), never a switcher — so
 * unlike the staff side, there is no "try another membership" fallback
 * here. A suspended organization is a hard, terminal denial for every one
 * of this function's callers, checked as the execution-level entry point
 * itself (not only in the (app) layout above it — see
 * PLATFORM_ADMIN_EXECUTION_AUTHORIZATION_AUDIT for why a layout-only
 * check would not be a complete fix).
 *
 * `currentPath`, when the caller already knows its own logical Portal
 * route (see redirectToPortalLoginForSessionLoss()'s own doc comment),
 * is preserved across the session-loss redirect so a re-authenticated
 * Portal user returns to it instead of the generic Portal root. Only
 * applies to the "no authUser at all" branch below — a genuine lost/
 * expired session; the separate "no usable PortalUser" branch just
 * below it is a wrong-identity-type denial, not session expiry, and
 * keeps its own unrelated plain redirect.
 */
export async function getCurrentPortalUser(currentPath?: string): Promise<CurrentPortalUser> {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    redirectToPortalLoginForSessionLoss(currentPath);
  }

  const identity = await resolvePortalIdentity(authUser);
  if (!identity) {
    redirect("/portal/login");
  }

  if (isOrganizationSuspended(await getOrganizationSuspensionState(identity.organizationId))) {
    redirect(ORGANIZATION_UNAVAILABLE_PATH);
  }

  return identity;
}

/**
 * A Client Portal identity's own resolvePortalIdentity() above only
 * selects Client fields, never Organization ones (it has no reason to —
 * every existing caller only ever needed organizationId as a scalar). One
 * small, separate, targeted read here rather than widening that shared
 * query's own select for every caller, most of which do not need this
 * check applied at all (see getOptionalPortalUser's own doc comment: its
 * callers make their own routing decisions and must never be redirected
 * out from under them).
 */
async function getOrganizationSuspensionState(organizationId: string): Promise<{ suspendedAt: Date | null }> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { suspendedAt: true },
  });
  // An organizationId this function is ever called with always came from
  // a real, just-resolved Client -> Organization relation (a foreign-key
  // guarantee, not a client-supplied value) — a missing row here would
  // mean the Organization was hard-deleted a moment after resolution, an
  // extreme race this function treats the same as "suspended": deny,
  // never treat a vanished organization as usable.
  return organization ?? { suspendedAt: new Date(0) };
}

/**
 * Non-throwing variant for identity-routing decisions (layouts, the portal
 * login action): returns null if there's no Supabase session, no PortalUser
 * row for it, or that PortalUser's Client has no organization. Never
 * redirects, so callers can inspect "why" (e.g. distinguish "no session at
 * all" from "session belongs to staff, not a portal contact") and decide
 * where to send the caller themselves.
 */
export async function getOptionalPortalUser(): Promise<CurrentPortalUser | null> {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return null;
  }

  return resolvePortalIdentity(authUser);
}
