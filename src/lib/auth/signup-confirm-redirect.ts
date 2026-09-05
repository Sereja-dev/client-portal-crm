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
 * Signup-confirmation defect fix (Invited Signup Confirmation Redirect
 * Investigation). Builds the *complete* confirmation link this app's own
 * branded signup-confirmation email (src/lib/email/signup-confirmation.ts)
 * sends — always this app's own /auth/confirm route (never a request-
 * derived host, never anything Supabase's own hosted verify endpoint or
 * native email template would construct), carrying the server-generated
 * `token_hash` (see src/lib/auth/signup-confirmation-token.ts) and a
 * same-origin-only `next` destination that src/app/auth/confirm/route.ts's
 * own type=signup branch re-sanitizes again on the way back out — defense
 * in depth, not the only check.
 *
 * This function replaces the earlier PR #188 `buildSignupConfirmRedirectTo`
 * (an `emailRedirectTo` value handed to `supabase.auth.signUp()`) — that
 * approach depended on Supabase's own native confirmation email/hosted
 * verify flow actually forwarding it, which the investigation this fix
 * follows from found it does not (the SDK's default implicit `flowType`
 * hands session state off via a URL fragment, never a server-visible
 * query parameter). This app no longer calls supabase.auth.signUp() for
 * the confirmation-required path at all — see signup-confirmation-token.ts.
 */
export function buildSignupConfirmationUrl(params: {
  tokenHash: string;
  invitation: ValidSignupInvitation | null;
}): string {
  const next = params.invitation ? sanitizeRedirectPath(`/invite/${params.invitation.token}`) : "/dashboard";
  const query = new URLSearchParams({ token_hash: params.tokenHash, type: "signup", next });
  return `${getAppBaseUrl()}/auth/confirm?${query.toString()}`;
}
