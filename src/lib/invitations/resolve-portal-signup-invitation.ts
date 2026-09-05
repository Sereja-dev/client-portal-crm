import { prisma } from "@/lib/prisma";

export type ValidPortalSignupInvitation = {
  token: string;
  email: string;
  clientName: string;
};

/**
 * Portal signup-confirmation defect fix. The Client Portal counterpart to
 * src/lib/invitations/resolve-signup-invitation.ts — same reasoning, same
 * shape, different model (ClientInvitation, not Invitation). Re-validates
 * an `invitationToken` value for the standalone Portal Sign Up flow
 * (src/app/portal/signup/page.tsx and actions.ts) — never trusted merely
 * because a query param or hidden form field claims one exists; the token
 * is used only as a lookup key.
 *
 * Deliberately does NOT check REVOKED/ACCEPTED status distinctly — returns
 * null uniformly for absolutely any invalid case (nonexistent, wrong
 * status, expired), the same generic, non-disclosing shape this app's
 * other invitation-adjacent checks already use. A probing request with a
 * forged/expired/wrong token simply degrades to plain standalone Portal
 * signup, never a distinguishable error.
 */
export async function resolveValidPortalSignupInvitation(rawToken: string): Promise<ValidPortalSignupInvitation | null> {
  const token = rawToken.trim();
  if (!token) return null;

  const invitation = await prisma.clientInvitation.findUnique({
    where: { token },
    select: {
      token: true,
      email: true,
      status: true,
      expiresAt: true,
      client: { select: { name: true } },
    },
  });

  if (!invitation) return null;
  if (invitation.status !== "PENDING") return null;
  if (invitation.expiresAt.getTime() <= Date.now()) return null;

  return {
    token: invitation.token,
    email: invitation.email,
    clientName: invitation.client.name,
  };
}
