import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { AcceptInvitationForm } from "@/components/invite/accept-invitation-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { acceptInvitationAction, signOutForInviteAction } from "./actions";

const PRIMARY_LINK_CLASSES =
  "bg-accent text-white hover:bg-accent-hover focus-visible:ring-focus-ring flex-1 inline-flex items-center justify-center rounded-md px-4 py-2 text-center text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";
const SECONDARY_LINK_CLASSES =
  "border-border-strong text-text-primary hover:bg-[var(--hover)] focus-visible:ring-focus-ring flex-1 inline-flex items-center justify-center rounded-md border px-4 py-2 text-center text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

/**
 * Pre-Auth Redesign, Slice A — same fixed dark shell every other pre-auth
 * route now uses. `topRightAction` is omitted whenever the viewer already
 * has an authenticated session (shown in both the matching- and
 * mismatched-email branches below) — "Sign in" would not be truthful for
 * someone who is already signed in, matching the Visual Spec's own
 * "only if truthful for current invite state" requirement. Token
 * semantics, invited-signup behavior, authenticated-acceptance behavior,
 * validation, and every redirect below are byte-for-byte unchanged from
 * before this file's own visual migration — only the shell/markup
 * changed.
 */
function InviteCard({
  title,
  authUser,
  children,
}: {
  title: string;
  authUser: { email?: string } | null;
  children: ReactNode;
}) {
  return (
    <AuthShell topRightAction={authUser ? undefined : { label: "Sign in", href: "/login" }}>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight text-text-primary sm:text-3xl">{title}</h1>
      {children}
    </AuthShell>
  );
}

function isExpired(expiresAt: Date): boolean {
  return expiresAt.getTime() <= Date.now();
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const invitation = await prisma.invitation.findUnique({
    where: { token },
    include: {
      organization: { select: { name: true } },
      invitedBy: { select: { name: true, email: true } },
    },
  });

  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  // Not found and REVOKED share one generic message — a valid-looking
  // token for a revoked invitation must be indistinguishable from a token
  // that never existed at all.
  if (!invitation || invitation.status === "REVOKED") {
    return (
      <InviteCard title="Invitation not found" authUser={authUser}>
        <p className="text-text-secondary text-sm">
          Invitation not found or no longer available.
        </p>
      </InviteCard>
    );
  }

  if (invitation.status === "ACCEPTED") {
    let alreadyMember = false;
    if (authUser) {
      const membership = await prisma.membership.findUnique({
        where: {
          userId_organizationId: { userId: authUser.id, organizationId: invitation.organizationId },
        },
        select: { id: true },
      });
      alreadyMember = !!membership;
    }

    return (
      <InviteCard title="Invitation already accepted" authUser={authUser}>
        <p className="text-text-secondary text-sm">
          This invitation to join {invitation.organization.name} has already
          been accepted.
        </p>
        {alreadyMember && (
          <Link href="/dashboard" className={`${PRIMARY_LINK_CLASSES} mt-4 inline-flex`}>
            Go to dashboard
          </Link>
        )}
      </InviteCard>
    );
  }

  // PENDING but past its expiry is treated the same as an explicit EXPIRED
  // status for display purposes — no write happens on this GET, so a
  // crawler or link-preview bot hitting this page can never mutate data.
  if (invitation.status === "EXPIRED" || isExpired(invitation.expiresAt)) {
    return (
      <InviteCard title="Invitation expired" authUser={authUser}>
        <p className="text-text-secondary text-sm">This invitation has expired.</p>
      </InviteCard>
    );
  }

  const redirectTarget = `/invite/${token}`;
  const normalizedInviteEmail = invitation.email.trim().toLowerCase();
  const normalizedUserEmail = authUser?.email?.trim().toLowerCase() ?? null;
  const emailMatches = normalizedUserEmail !== null && normalizedUserEmail === normalizedInviteEmail;

  return (
    <InviteCard title="You're invited" authUser={authUser}>
      <div className="text-text-secondary space-y-2 text-sm">
        <p>
          You&apos;ve been invited to join{" "}
          <span className="text-text-primary font-medium">
            {invitation.organization.name}
          </span>
          .
        </p>
        <p className="flex items-center gap-2">
          <span>Role:</span>
          <StatusBadge status={invitation.role} />
        </p>
        <p>
          Invited email:{" "}
          <span className="text-text-primary font-medium">{invitation.email}</span>
        </p>
        {invitation.invitedBy && (
          <p>
            Invited by:{" "}
            <span className="text-text-primary font-medium">
              {invitation.invitedBy.name ?? invitation.invitedBy.email}
            </span>
          </p>
        )}
        <p>Expires: {invitation.expiresAt.toLocaleDateString()}</p>
      </div>

      <div className="mt-6">
        {!authUser && (
          <div className="flex gap-3">
            <Link href={`/login?redirectTo=${encodeURIComponent(redirectTarget)}`} className={PRIMARY_LINK_CLASSES}>
              Log in
            </Link>
            <Link
              href={`/signup?invitationToken=${encodeURIComponent(token)}&redirectTo=${encodeURIComponent(redirectTarget)}`}
              className={SECONDARY_LINK_CLASSES}
            >
              Sign up
            </Link>
          </div>
        )}

        {authUser && !emailMatches && (
          <div className="space-y-3">
            <p className="text-text-secondary text-sm">
              This invitation was sent to{" "}
              <span className="text-text-primary font-medium">
                {invitation.email}
              </span>
              , but you&apos;re signed in as{" "}
              <span className="text-text-primary font-medium">{authUser.email}</span>
              .
            </p>
            <form action={signOutForInviteAction.bind(null, token)}>
              <Button type="submit" variant="secondary" className="w-full">
                Sign out and log in with the right account
              </Button>
            </form>
          </div>
        )}

        {authUser && emailMatches && (
          <AcceptInvitationForm action={acceptInvitationAction.bind(null, token)} />
        )}
      </div>
    </InviteCard>
  );
}
