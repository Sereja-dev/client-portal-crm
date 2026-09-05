import { sanitizeRedirectPath } from "@/lib/safe-redirect";
import type { ValidSignupInvitation } from "@/lib/invitations/resolve-signup-invitation";

/**
 * Same getAppBaseUrl() shape already independently duplicated into every
 * other absolute-URL builder in this codebase (src/lib/email/invitations.ts
 * and its sibling email modules, src/lib/billing/provider/paddle-provider.ts,
 * src/lib/organization-setup/domain-settings.ts) — this is that same
 * established, deliberately-per-module convention, not a new pattern.
 */
function getAppBaseUrl(): string {
  const explicit = process.env.APP_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");

  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) return `https://${vercelUrl}`.replace(/\/+$/, "");

  return "http://localhost:3000";
}

/**
 * Invited-signup defect fix, secondary half. Supabase's own signUp() had
 * no `emailRedirectTo` at all before this fix — meaning a project with
 * email confirmation enabled would fall back to Supabase's bare Site URL
 * after confirming, silently dropping any invitation context. This builds
 * this app's own, trusted, absolute confirmation-return URL — always this
 * app's own /auth/confirm route (never a request-derived host, never
 * Supabase's own default), carrying a same-origin-only `next` destination
 * (src/app/auth/confirm/route.ts's own type=signup branch re-sanitizes
 * this again on the way back out — this is defense in depth, not the only
 * check). Standalone signup keeps the existing default landing page.
 *
 * Kept as its own pure, non-"use server" module (not inlined into
 * src/app/(auth)/signup/actions.ts) purely so it's directly, synchronously
 * unit-testable — every export from a "use server" file must itself be an
 * async Server Action, which this deliberately is not.
 */
export function buildSignupConfirmRedirectTo(invitation: ValidSignupInvitation | null): string {
  const next = invitation ? sanitizeRedirectPath(`/invite/${invitation.token}`) : "/dashboard";
  const params = new URLSearchParams({ type: "signup", next });
  return `${getAppBaseUrl()}/auth/confirm?${params.toString()}`;
}
