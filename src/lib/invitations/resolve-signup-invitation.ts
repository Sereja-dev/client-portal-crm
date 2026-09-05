import { prisma } from "@/lib/prisma";

export type ValidSignupInvitation = {
  token: string;
  email: string;
  organizationName: string;
};

/**
 * Invited-signup defect fix. Re-validates an `invitationToken` value for
 * the standalone Sign Up flow (src/app/(auth)/signup/page.tsx and
 * actions.ts) — never trusted merely because a query param or hidden form
 * field claims one exists; the token is used only as a lookup key, exactly
 * like every other token-bearing flow in this app (acceptInvitationAction,
 * verifyRecoveryToken).
 *
 * Mirrors the exact validity predicate src/app/invite/[token]/page.tsx
 * already uses for its own display (status PENDING, not expired) — kept
 * as its own copy here rather than imported from that page (which is a
 * page component and exports no reusable helpers), so a future change to
 * either surface's own rendering logic can never silently change this
 * validation's own security-relevant meaning.
 *
 * Deliberately does NOT check invitation.role or REVOKED/ACCEPTED status
 * distinctly — returns null uniformly for absolutely any invalid case
 * (nonexistent, wrong status, expired), the same generic, non-disclosing
 * shape this app's other invitation-adjacent checks already use. A probing
 * request with a forged/expired/wrong token simply degrades to plain
 * standalone signup, never a distinguishable error.
 */
export async function resolveValidSignupInvitation(rawToken: string): Promise<ValidSignupInvitation | null> {
  const token = rawToken.trim();
  if (!token) return null;

  const invitation = await prisma.invitation.findUnique({
    where: { token },
    select: {
      token: true,
      email: true,
      status: true,
      expiresAt: true,
      organization: { select: { name: true } },
    },
  });

  if (!invitation) return null;
  if (invitation.status !== "PENDING") return null;
  if (invitation.expiresAt.getTime() <= Date.now()) return null;

  return {
    token: invitation.token,
    email: invitation.email,
    organizationName: invitation.organization.name,
  };
}
