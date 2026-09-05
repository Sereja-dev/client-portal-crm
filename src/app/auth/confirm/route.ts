import { NextResponse } from "next/server";
import type { User as SupabaseAuthUser } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { verifyRecoveryToken, testModeRecoveryCookie } from "@/lib/auth/recovery-token";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateUser, getOrCreateOrganizationId } from "@/lib/current-user";
import { TEST_MODE } from "@/lib/test-mode";
import { sanitizeRedirectPath, sanitizePortalRedirectPath } from "@/lib/safe-redirect";

/**
 * Sale-Ready Phase B, PR1 (Password Recovery). The one link every
 * password-reset email points at (see src/lib/email/password-reset.ts) —
 * shared by both staff and portal, rather than two near-identical routes,
 * since the only thing that differs between them is which page to land on
 * afterward.
 *
 * `audience` is only ever a pre-verification default for the invalid/
 * expired fallback below — never trusted for anything past that. Once a
 * token verifies, the destination is re-derived authoritatively from the
 * now-confirmed identity's own User/PortalUser row, exactly like every
 * other staff-vs-portal resolution in this app already works (see
 * portalLogin's own Membership fallback in src/app/portal/login/
 * actions.ts). A manipulated `audience` value can therefore never do
 * anything worse than pick the wrong (but still legitimate, in-app)
 * landing page before verification fails outright — this route has no
 * open-redirect surface at all, by construction, not by validation.
 */
const DESTINATIONS = {
  staff: "/reset-password",
  portal: "/portal/reset-password",
} as const;

/**
 * Invited-signup defect fix, secondary half. Pure — no I/O — so the
 * `next` sanitization is unit-testable independently of a real Supabase
 * OTP verification. `next` only ever comes from this app's own
 * `emailRedirectTo` (see src/app/(auth)/signup/actions.ts's own
 * buildSignupConfirmRedirectTo), but is re-sanitized here regardless —
 * defense in depth, the same "never trust it twice for the same reason"
 * discipline `audience` above already documents. Never an open redirect:
 * sanitizeRedirectPath() rejects anything that isn't a same-origin
 * relative path.
 */
export function resolveSignupConfirmDestination(nextParam: string | null): string {
  return sanitizeRedirectPath(nextParam, "/dashboard");
}

/**
 * Portal signup-confirmation defect fix. The Client Portal counterpart to
 * resolveSignupConfirmDestination() above — uses sanitizePortalRedirectPath,
 * never the Staff sanitizer, so a Portal-originated confirmation can never
 * redirect anywhere outside /portal.
 */
export function resolvePortalSignupConfirmDestination(nextParam: string | null): string {
  return sanitizePortalRedirectPath(nextParam);
}

/**
 * Shared by both handleSignupConfirm (Staff) and handlePortalSignupConfirm
 * (Portal) below — the one real `auth.verifyOtp()` call, identical at the
 * Supabase API level regardless of which application flow originated the
 * token (Supabase itself has no concept of "Staff" vs "Portal", only a
 * real `type: "signup"` OTP). Returns null for every failure case
 * (missing tokenHash, TEST_MODE, a rejected/expired/already-used token) —
 * callers never need to distinguish why, only that verification failed.
 *
 * This sandbox has no real Supabase Auth to verify an OTP against (see
 * src/lib/test-mode.ts), and signup confirmation has no TEST_MODE token
 * store the way recovery-token.ts's own recovery flow does — E2E never
 * exercises this exact code path (its own signup coverage runs through
 * the "session established immediately" branch of signup()/portalSignup()
 * themselves, never a real email-confirmation round-trip). TEST_MODE
 * therefore always resolves to "unverifiable" here, rather than
 * fabricating a second, parallel fake-token store this app has no real
 * test coverage for.
 */
async function verifySignupOtp(tokenHash: string | null): Promise<SupabaseAuthUser | null> {
  if (!tokenHash || TEST_MODE) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ type: "signup", token_hash: tokenHash });
  if (error || !data.session || !data.user) return null;

  return data.user;
}

/**
 * Invited-signup defect fix. Handles `type=signup` — the confirmation
 * link a brand-new Staff user's own signup-confirmation-token flow
 * causes Aqenra's own Resend email to send when the project requires
 * email confirmation (see src/app/(auth)/signup/actions.ts). Verifies via
 * verifySignupOtp() (never Supabase's own hosted action_link), then
 * redirects to the already-sanitized `next` destination — for an
 * invitation-originated signup, this is `/invite/<token>`, so the user
 * lands back on the invitation to explicitly accept it via the existing,
 * unchanged acceptInvitationAction() — this route itself never accepts
 * anything.
 */
async function handleSignupConfirm(tokenHash: string | null, nextParam: string | null, origin: string): Promise<NextResponse> {
  const destination = resolveSignupConfirmDestination(nextParam);

  const user = await verifySignupOtp(tokenHash);
  if (!user) {
    return NextResponse.redirect(new URL("/signup?invalid=1", origin));
  }

  // Signup-confirmation defect fix, standalone-signup provisioning
  // handoff. A standalone signup's typed Organization name has no other
  // durable place to survive the gap between form submission and this
  // later, separate confirmation request — src/app/(auth)/signup/
  // actions.ts's own generateToken() call is the only place that ever
  // writes it, into Supabase's own user_metadata, and only for a
  // standalone (non-invited) signup; an invitation-originated signup
  // never sets it at all, so this is a no-op on that path. Deliberately
  // never sourced from a query parameter — this app already established
  // (Sale-Ready Phase B) that untrusted request input must never resolve
  // an organization; the only place this value ever came from is the
  // already-validated form submission itself, round-tripped through
  // Supabase's own server-side user record, never anything client-
  // supplied on this exact request.
  //
  // getOrCreateOrganizationId() is the exact same idempotent function the
  // pre-confirmation-required immediate-session branch of signup() itself
  // already calls — safe to call again here for the same reason its own
  // doc comment already gives ("idempotent and safe to call on every
  // request"); (dashboard)/layout.tsx's own existing lazy-provisioning
  // fallback remains the safety net if this is ever skipped for any
  // reason, so a standalone user is never left without an organization —
  // only without their originally-typed name for it.
  const organizationName =
    typeof user.user_metadata?.organizationName === "string" ? user.user_metadata.organizationName.trim() : "";

  const prismaUser = await getOrCreateUser();
  if (organizationName) {
    await getOrCreateOrganizationId(prismaUser, organizationName);
  }

  return NextResponse.redirect(new URL(destination, origin));
}

/**
 * Portal signup-confirmation defect fix. Handles `type=portal_signup` —
 * the Client Portal counterpart to handleSignupConfirm above, and its own
 * deliberately DIFFERENT route `type` value (never Supabase's own
 * `type: "signup"`, which verifySignupOtp() still passes to the real
 * `auth.verifyOtp()` call regardless — Supabase itself has no separate
 * OTP type for this) — this is what lets this route tell a Portal-
 * originated confirmation apart from a Staff one and enforce the critical
 * design rule structurally: this function establishes the verified
 * session and redirects, and does nothing else. It never calls
 * getOrCreateUser(), getOrCreateOrganizationId(), or anything that could
 * create a Staff User, Organization, or Membership — and it never creates
 * a PortalUser either. acceptClientInvitationAction() (unchanged) remains
 * the sole place a PortalUser is ever created, once the user explicitly
 * clicks Accept on the invitation page this redirects back to.
 */
async function handlePortalSignupConfirm(tokenHash: string | null, nextParam: string | null, origin: string): Promise<NextResponse> {
  const destination = resolvePortalSignupConfirmDestination(nextParam);

  const user = await verifySignupOtp(tokenHash);
  if (!user) {
    return NextResponse.redirect(new URL("/portal/signup?invalid=1", origin));
  }

  return NextResponse.redirect(new URL(destination, origin));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");

  // Invited-signup defect fix + Portal signup-confirmation defect fix.
  // `type=signup` (Staff) and `type=portal_signup` (Client Portal) are the
  // only new branches — anything else (absent, or the recovery flow's own
  // implicit default) falls through to the existing, completely unchanged
  // recovery logic below.
  if (url.searchParams.get("type") === "signup") {
    return handleSignupConfirm(tokenHash, url.searchParams.get("next"), url.origin);
  }
  if (url.searchParams.get("type") === "portal_signup") {
    return handlePortalSignupConfirm(tokenHash, url.searchParams.get("next"), url.origin);
  }

  const audienceHint = url.searchParams.get("audience") === "portal" ? "portal" : "staff";
  const fallback = DESTINATIONS[audienceHint];

  if (!tokenHash) {
    return NextResponse.redirect(new URL(`${fallback}?invalid=1`, url.origin));
  }

  const verified = await verifyRecoveryToken(tokenHash);
  if (!verified.ok) {
    return NextResponse.redirect(new URL(`${fallback}?invalid=1`, url.origin));
  }

  const [staffUser, portalUser] = await Promise.all([
    prisma.user.findUnique({ where: { email: verified.email }, select: { id: true } }),
    prisma.portalUser.findFirst({ where: { email: verified.email }, select: { id: true } }),
  ]);

  const isPortal = Boolean(portalUser) && !staffUser;
  const destination = isPortal ? DESTINATIONS.portal : DESTINATIONS.staff;
  const localId = isPortal ? portalUser?.id : staffUser?.id;

  const response = NextResponse.redirect(new URL(destination, url.origin));

  // null outside TEST_MODE — a real verifyOtp() call inside
  // verifyRecoveryToken() already established the real session as a side
  // effect. In TEST_MODE, this is what actually logs the identity in; set
  // directly on this exact response object, not via next/headers'
  // cookies() — see testModeRecoveryCookie's own doc comment for why.
  const cookie = localId ? testModeRecoveryCookie({ id: localId, email: verified.email }) : null;
  if (cookie) {
    response.cookies.set(cookie.name, cookie.value, cookie.options);
  }

  return response;
}
