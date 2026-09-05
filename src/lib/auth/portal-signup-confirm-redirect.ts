import { sanitizePortalRedirectPath } from "@/lib/safe-redirect";
import type { ValidPortalSignupInvitation } from "@/lib/invitations/resolve-portal-signup-invitation";

/**
 * Same getAppBaseUrl() shape already independently duplicated into every
 * other absolute-URL builder in this codebase (src/lib/email/invitations.ts
 * and its sibling email modules, src/lib/auth/signup-confirm-redirect.ts,
 * src/lib/billing/provider/paddle-provider.ts,
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
 * Portal signup-confirmation defect fix. The Client Portal counterpart to
 * src/lib/auth/signup-confirm-redirect.ts's buildSignupConfirmationUrl —
 * same reasoning (own the whole confirmation link, never depend on
 * Supabase's native email/hosted-verify flow), but a deliberately
 * DIFFERENT route `type` value (`portal_signup`, not `signup`) so
 * src/app/auth/confirm/route.ts can tell the two apart and never run
 * Staff provisioning logic (getOrCreateUser/getOrCreateOrganizationId)
 * for a Portal-originated confirmation — see that route's own doc
 * comment. `next` is sanitized with sanitizePortalRedirectPath, never the
 * Staff sanitizer — a Portal confirmation must never be able to redirect
 * anywhere outside /portal.
 */
export function buildPortalSignupConfirmationUrl(params: {
  tokenHash: string;
  invitation: ValidPortalSignupInvitation | null;
}): string {
  const next = params.invitation
    ? sanitizePortalRedirectPath(`/portal/invite/${params.invitation.token}`)
    : "/portal";
  const query = new URLSearchParams({ token_hash: params.tokenHash, type: "portal_signup", next });
  return `${getAppBaseUrl()}/auth/confirm?${query.toString()}`;
}
