import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyRecoveryToken, testModeRecoveryCookie } from "@/lib/auth/recovery-token";
import { createClient } from "@/lib/supabase/server";
import { TEST_MODE } from "@/lib/test-mode";
import { sanitizeRedirectPath } from "@/lib/safe-redirect";

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
 * Invited-signup defect fix. Handles `type=signup` — the confirmation
 * link a brand-new user's own signUp() call causes Supabase to send when
 * the project requires email confirmation. Verifies via the same real
 * `auth.verifyOtp()` call shape the recovery path below already uses
 * (never Supabase's own hosted action_link), then redirects to the
 * already-sanitized `next` destination — for an invitation-originated
 * signup, this is `/invite/<token>` (see buildSignupConfirmRedirectTo),
 * so the user lands back on the invitation to explicitly accept it via
 * the existing, unchanged acceptInvitationAction() — this route itself
 * never creates an Organization, Membership, or accepts anything.
 */
async function handleSignupConfirm(tokenHash: string | null, nextParam: string | null, origin: string): Promise<NextResponse> {
  const destination = resolveSignupConfirmDestination(nextParam);

  if (!tokenHash) {
    return NextResponse.redirect(new URL("/signup?invalid=1", origin));
  }

  // This sandbox has no real Supabase Auth to verify an OTP against (see
  // src/lib/test-mode.ts), and signup confirmation has no TEST_MODE token
  // store the way recovery-token.ts's own recovery flow does — E2E never
  // exercises this exact code path (its own signup coverage runs through
  // the "session established immediately" branch of signup() itself,
  // never a real email-confirmation round-trip). Redirects to the same
  // invalid-link state a real unverifiable token would produce, rather
  // than fabricating a second, parallel fake-token store this app has no
  // real test coverage for.
  if (TEST_MODE) {
    return NextResponse.redirect(new URL("/signup?invalid=1", origin));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ type: "signup", token_hash: tokenHash });
  if (error || !data.session) {
    return NextResponse.redirect(new URL("/signup?invalid=1", origin));
  }

  return NextResponse.redirect(new URL(destination, origin));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");

  // Invited-signup defect fix. `type=signup` is the only new branch —
  // anything else (absent, or the recovery flow's own implicit default)
  // falls through to the existing, completely unchanged recovery logic
  // below.
  if (url.searchParams.get("type") === "signup") {
    return handleSignupConfirm(tokenHash, url.searchParams.get("next"), url.origin);
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
