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

  // Dual-identity minimal hardening. Server-side only — never a
  // client-supplied flag, and never anything beyond a boolean reaching
  // the rendered page (no organizationId/userId/internal id of any kind
  // is exposed). Only computed on the exact branch that can actually
  // render the accept form below, so an already-Staff visitor sees a
  // plain-language heads-up before accepting, without changing
  // acceptClientInvitationAction's own behavior or the email-match check
  // above it in any way.
  const alreadyStaffAtThisEmail =
    authUser && emailMatches
      ? Boolean(await prisma.user.findUnique({ where: { id: authUser.id }, select: { id: true } }))
      : false;

  // Portal Invite — Existing Portal User Acceptance Bugfix. The MVP
  // Portal identity model is exactly one Client per PortalUser row (see
  // acceptClientInvitationAction's own CONFLICTING_PORTAL_USER check,
  // which this mirrors read-only) — a signed-in account already linked
  // to a *different* Client can never successfully accept this
  // invitation. Detected here, before the Accept button is ever shown,
  // so the visitor sees a clear, honest explanation up front instead of
  // clicking Accept and hitting a same-looking-as-every-other-failure
  // generic error. Never reveals which other Client this account is
  // already linked to — that would leak cross-tenant information to
  // whoever is looking at this screen.
  const conflictingPortalAccount =
    authUser && emailMatches
      ? await prisma.portalUser
          .findUnique({ where: { id: authUser.id }, select: { clientId: true } })
          .then((existing) => existing !== null && existing.clientId !== invitation.clientId)
      : false;

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

        {authUser && emailMatches && conflictingPortalAccount && (
          <div className="space-y-3">
            <p className="text-text-muted text-sm">
              This account already has Client Portal access for a different client. One
              Client Portal account can only be connected to a single client today, so this
              invitation can&apos;t be accepted while signed in as{" "}
              <span className="text-text-primary font-medium">{authUser.email}</span>. Sign
              out and use a different account, or contact the business that invited you.
            </p>
            <form action={signOutForPortalInviteAction.bind(null, token)}>
              <button type="submit" className={`w-full ${SECONDARY_LINK_CLASSES}`}>
                Sign out and use a different account
              </button>
            </form>
          </div>
        )}

        {authUser && emailMatches && !conflictingPortalAccount && (
          <div className="space-y-3">
            {alreadyStaffAtThisEmail && (
              <div role="status" className="border-warning bg-warning-subtle text-warning rounded-md border p-3 text-sm">
                Heads up — you&apos;re already signed in with a Staff account at this email.
                Accepting this invitation will also give you Client Portal access for this
                client. Your Staff account won&apos;t be changed.
              </div>
            )}
            <AcceptClientInvitationForm
              action={acceptClientInvitationAction.bind(null, token)}
            />
          </div>
        )}
      </div>
    </InviteCard>
  );
}
