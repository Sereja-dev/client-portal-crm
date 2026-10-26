import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

export type PrismaClientOrTx = typeof prisma | Prisma.TransactionClient;

export type OrganizationUsage = {
  members: number;
  clients: number;
  projects: number;
  storageBytes: number;
};

/**
 * Billing & Subscriptions Stage 2 (docs/billing-architecture.md §7/§10).
 * One bounded, org-scoped read per call — four independent aggregate
 * queries run concurrently (Promise.all), never N+1, never a full-table
 * scan. Accepts a Prisma client explicitly (matching this codebase's own
 * `createActivity(tx, input)` convention) so a caller enforcing a limit
 * atomically alongside a write (src/lib/billing/enforcement.ts) can pass
 * its own transaction client and get a consistent snapshot from inside
 * that same transaction, not a separately-committed read.
 *
 * Deliberately excludes Tasks/Invoices/Comments — not limited dimensions
 * for v1 (docs/billing-architecture.md §3's own "not Tasks/Invoices" rule)
 * — and PortalUsers, which are never seat-limited (§8's explicit "Invite
 * Client Portal user" row: deliberately unlimited in v1).
 *
 * `members` counts real Membership rows only — PENDING Invitation rows are
 * a deliberately separate concern, added in by the entitlements layer
 * itself (getOrganizationEntitlements in entitlements.ts) rather than
 * folded in here, so this function's own "members" always means exactly
 * "real seats filled today," independent of how a caller chooses to
 * combine it with pending invites.
 *
 * Client/Project/Attachment rows in this schema have no soft-delete
 * concept (no `deletedAt` column — unlike Comment) — every existing row is
 * already a "live" one, so no extra status filtering is needed here.
 */
export async function getOrganizationUsage(
  client: PrismaClientOrTx,
  organizationId: string,
): Promise<OrganizationUsage> {
  const [members, clients, projects, storageAgg] = await Promise.all([
    client.membership.count({ where: { organizationId } }),
    client.client.count({ where: { organizationId } }),
    client.project.count({ where: { organizationId } }),
    client.attachment.aggregate({
      where: { organizationId },
      _sum: { sizeBytes: true },
    }),
  ]);

  return {
    members,
    clients,
    projects,
    storageBytes: storageAgg._sum.sizeBytes ?? 0,
  };
}

/**
 * Free Public Beta, Slice 2 (Expired Invitations / Member Capacity). The
 * one, single, authoritative count of PENDING invitations that currently
 * reserve a seat — never a second, independently-maintained copy of this
 * predicate. Before this fix, getOrganizationEntitlements()
 * (src/lib/billing/entitlements.ts) and getBillingPageData()
 * (src/lib/billing/view-model.ts) each ran their own `status: "PENDING"`
 * count with no expiry awareness, so a calendar-expired-but-still-PENDING
 * invitation (see src/app/(dashboard)/team/page.tsx's own "MODEL A"
 * comment — nothing in this codebase ever transitions `status` away from
 * PENDING on expiry, by deliberate, already-audited design) reserved a
 * seat forever, with no way to free it short of an explicit cancel. Both
 * call sites now call this one function instead — the enforcement check
 * (`canInviteMember`) and the Billing page's own display can therefore
 * never disagree about how many seats are occupied.
 *
 * The boundary matches acceptInvitationAction's own rejection exactly
 * (`invitation.expiresAt.getTime() <= Date.now()` is expired,
 * src/app/invite/[token]/actions.ts) and team/page.tsx's own
 * isInvitationExpired() — an invitation reserves a seat only when
 * `expiresAt > now`, strictly (Prisma's `gt`). `now` is always supplied
 * by the caller, never read internally — the same "caller supplies now"
 * discipline src/lib/billing/access-mode.ts already establishes for
 * computeAccessMode() — so every boundary case (before/at/after `now`)
 * stays exactly reproducible in tests, with no hidden dependency on the
 * real wall clock.
 */
export async function countReservedPendingInvitations(
  client: PrismaClientOrTx,
  organizationId: string,
  now: Date,
): Promise<number> {
  return client.invitation.count({
    where: { organizationId, status: "PENDING", expiresAt: { gt: now } },
  });
}
