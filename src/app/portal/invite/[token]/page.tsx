import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { AcceptClientInvitationForm } from "@/components/client-portal/accept-client-invitation-form";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { acceptClientInvitationAction, signOutForPortalInviteAction } from "./actions";

const PRIMARY_LINK_CLASSES =
  "focus-visible:ring-focus-ring rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";
const SECONDARY_LINK_CLASSES =
  "border-border-strong text-text-secondary focus-visible:ring-focus-ring rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

function InviteCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="bg-surface-recessed flex min-h-screen items-center justify-center px-4">
      <div className={`w-full max-w-sm p-8 shadow-sm ${CARD_SURFACE_CLASSES}`}>
        <h1 className="text-text-primary mb-6 text-2xl font-semibold tracking-tight">
          {title}
        </h1>
        {children}
      </div>
    </main>
  );
}

function isExpired(expiresAt: Date): boolean {
  return expiresAt.getTime() <= Date.now();
}

export default async function ClientInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const invitation = await prisma.clientInvitation.findUnique({
    where: { token },
    include: { client: { select: { name: true, organizationId: true } } },
  });

  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  // Not found, REVOKED, and a Client with no organization all share one
  // generic message — a valid-looking token that can't be safely scoped
  // must be indistinguishable from a token that never existed at all.
  if (!invitation || invitation.status === "REVOKED" || !invitation.client.organizationId) {
    return (
      <InviteCard title="Invitation not found">
        <p className="text-text-muted text-sm">
          Invitation not found or no longer available.
        </p>
      </InviteCard>
    );
  }

  if (invitation.status === "ACCEPTED") {
    let alreadyAccepted = false;
    if (authUser) {
      const portalUser = await prisma.portalUser.findUnique({
        where: { id: authUser.id },
        select: { clientId: true },
      });
      alreadyAccepted = !!portalUser && portalUser.clientId === invitation.clientId;
    }

    return (
      <InviteCard title="Invitation already accepted">
        <p className="text-text-muted text-sm">
          This invitation to {invitation.client.name}&apos;s client portal has
          already been accepted.
        </p>
        {alreadyAccepted && (
          <Link href="/portal" className={`mt-4 inline-block ${PRIMARY_LINK_CLASSES}`}>
            Go to portal
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
      <InviteCard title="Invitation expired">
        <p className="text-text-muted text-sm">This invitation has expired.</p>
      </InviteCard>
    );
  }

  const redirectTarget = `/portal/invite/${token}`;
  const normalizedInviteEmail = invitation.email.trim().toLowerCase();
  const normalizedUserEmail = authUser?.email?.trim().toLowerCase() ?? null;
  const emailMatches = normalizedUserEmail !== null && normalizedUserEmail === normalizedInviteEmail;

  return (
    <InviteCard title="You're invited">
      <div className="text-text-muted space-y-2 text-sm">
        <p>
          You&apos;ve been invited to the client portal for{" "}
          <span className="text-text-primary font-medium">
            {invitation.client.name}
          </span>
          .
        </p>
        <p>
          Invited email:{" "}
          <span className="text-text-primary font-medium">{invitation.email}</span>
        </p>
        <p>Expires: {invitation.expiresAt.toLocaleDateString()}</p>
      </div>

      <div className="mt-6">
        {!authUser && (
          <div className="flex gap-3">
            <Link
              href={`/portal/login?redirectTo=${encodeURIComponent(redirectTarget)}`}
              className={`flex-1 text-center ${PRIMARY_LINK_CLASSES}`}
            >
              Client Portal login
            </Link>
            <Link
              href={`/portal/signup?invitationToken=${encodeURIComponent(token)}&redirectTo=${encodeURIComponent(redirectTarget)}`}
              className={`flex-1 text-center ${SECONDARY_LINK_CLASSES}`}
            >
              Sign up
            </Link>
          </div>
        )}

        {authUser && !emailMatches && (
          <div className="space-y-3">
            <p className="text-text-muted text-sm">
              This invitation was sent to{" "}
              <span className="text-text-primary font-medium">
                {invitation.email}
              </span>
              , but you&apos;re signed in as{" "}
              <span className="text-text-primary font-medium">{authUser.email}</span>
              .
            </p>
            <form action={signOutForPortalInviteAction.bind(null, token)}>
              <button type="submit" className={`w-full ${SECONDARY_LINK_CLASSES}`}>
                Sign out and log in with the right account
              </button>
            </form>
          </div>
        )}

        {authUser && emailMatches && (
          <AcceptClientInvitationForm
            action={acceptClientInvitationAction.bind(null, token)}
          />
        )}
      </div>
    </InviteCard>
  );
}
