import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

export type PrismaClientOrTx = typeof prisma | Prisma.TransactionClient;

export type OrganizationUsage = {
  members: number;
  clients: number;
  projects: number;
  /** Aqenra Free plan's own dimension — see countActiveProjects's own doc comment for exactly what counts. Always computed, even for plans with no active-project ceiling (maxActiveProjects: null) — one more cheap aggregate query, and it keeps this type's shape, and buildOrganizationEntitlements's own usage parameter, identical for every plan. */
  activeProjects: number;
  storageBytes: number;
};

/**
 * Billing & Subscriptions Stage 2 (docs/billing-architecture.md §7/§10).
 * One bounded, org-scoped read per call — independent aggregate queries
 * run concurrently (Promise.all), never N+1, never a full-table scan.
 * Accepts a Prisma client explicitly (matching this codebase's own
 * `createActivity(tx, input)` convention) so a caller enforcing a limit
 * atomically alongside a write (src/lib/billing/enforcement.ts) can pass
 * its own transaction client and get a consistent snapshot from inside
 * that same transaction, not a separately-committed read.
 *
 * Deliberately excludes Tasks/Comments — not limited dimensions for v1
 * (docs/billing-architecture.md §3's own "not Tasks/Invoices" rule) — and
 * PortalUsers, which are never seat-limited (§8's explicit "Invite Client
 * Portal user" row: deliberately unlimited in v1). Invoices themselves are
 * likewise never limited, but their archived PDF storage IS counted (see
 * `storageBytes`'s own comment below) — a storage-byte concern, not a
 * count-of-invoices one.
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
 *
 * `storageBytes` — Aqenra Free plan storage accounting, corrected after
 * the pre-push review found this previously summed only Attachment rows.
 * Sums exactly three real, organization-scoped Storage object types this
 * application actually writes:
 *   1. Attachment.sizeBytes (CLIENT/PROJECT/INVOICE attachments) — always
 *      recorded at upload time, unchanged.
 *   2. InvoicePdfArchiveObject.sizeBytes, for rows whose `status` is
 *      REFERENCED (a confirmed, live archived PDF) or CLEANUP_PENDING (a
 *      compensating removal may still be in flight — counted
 *      conservatively, never assumed already gone). PENDING_UPLOAD and
 *      CLEANED rows are excluded (never finalized, or confirmed removed).
 *      `sizeBytes` is `null` for every row created before this column
 *      existed — a `null` contributes 0, a known, documented gap for
 *      pre-existing Invoices (see this column's own migration comment);
 *      it does not affect any brand-new Free-plan organization, which has
 *      no pre-existing Invoices by construction.
 *   3. OrganizationProfile.logoSizeBytes — the one real, non-Attachment,
 *      non-Invoice Storage write this application has (uploadLogoObject,
 *      a dedicated public bucket). `null` (contributes 0) for a logo
 *      uploaded before this column existed, for the identical reason.
 * User.avatarUrl is deliberately NOT counted: nothing in this application
 * writes to it today (confirmed by inspection — it is read only, in one
 * Platform Admin query) — there is no real upload path to account for.
 * Quote/Contract PDFs are generated on demand and are not persisted to
 * Storage at all, so there is nothing to count there either.
 */
export async function getOrganizationUsage(
  client: PrismaClientOrTx,
  organizationId: string,
): Promise<OrganizationUsage> {
  const [members, clients, projects, activeProjects, attachmentAgg, invoicePdfAgg, logoAgg] = await Promise.all([
    client.membership.count({ where: { organizationId } }),
    client.client.count({ where: { organizationId } }),
    client.project.count({ where: { organizationId } }),
    countActiveProjects(client, organizationId),
    client.attachment.aggregate({
      where: { organizationId },
      _sum: { sizeBytes: true },
    }),
    client.invoicePdfArchiveObject.aggregate({
      where: { organizationId, status: { in: ["REFERENCED", "CLEANUP_PENDING"] } },
      _sum: { sizeBytes: true },
    }),
    client.organizationProfile.aggregate({
      where: { organizationId },
      _sum: { logoSizeBytes: true },
    }),
  ]);

  const storageBytes =
    (attachmentAgg._sum.sizeBytes ?? 0) + (invoicePdfAgg._sum.sizeBytes ?? 0) + (logoAgg._sum.logoSizeBytes ?? 0);

  return {
    members,
    clients,
    projects,
    activeProjects,
    storageBytes,
  };
}

/**
 * Aqenra Free plan — the one, database-level counting rule for "active
 * project" as the owner's limit means it: resolveProjectCountsTowardActiveLimit's
 * (src/lib/custom-statuses/semantics.ts) own exact predicate, expressed as
 * a `where` clause instead of a per-row loop. Reads the one explicit
 * `countsAsActiveProject` column every Project status definition carries
 * (CustomStatusDefinition's own schema comment) directly via a relation
 * filter — never re-derives it from `key`/`isSystem` here, so a
 * Settings-side reclassification of a CUSTOM status
 * (src/app/(dashboard)/settings/custom-statuses/actions.ts) is reflected
 * the moment it's saved, with no change needed in this function. A
 * legacy row with no statusDefinition at all falls back to the legacy
 * `status` enum, matching resolveProjectCountsTowardActiveLimit's own
 * identical fallback exactly (COMPLETED/CANCELLED excluded, everything
 * else counted).
 */
export async function countActiveProjects(client: PrismaClientOrTx, organizationId: string): Promise<number> {
  const where: Prisma.ProjectWhereInput = {
    organizationId,
    OR: [
      { statusDefinition: { countsAsActiveProject: true } },
      { statusDefinitionId: null, status: { notIn: ["COMPLETED", "CANCELLED"] } },
    ],
  };

  return client.project.count({ where });
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
