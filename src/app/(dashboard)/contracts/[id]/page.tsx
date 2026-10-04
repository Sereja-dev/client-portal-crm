import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { getContractForStaff } from "@/lib/contracts/queries";
import { isContractPreviewable } from "@/lib/contracts/status";
import {
  parseContractOrganizationSnapshot,
  parseContractClientSnapshot,
  parseContractSignatorySnapshot,
} from "@/lib/contracts/snapshot-types";
import { ContractStatusBadge } from "@/components/contracts/contract-status-badge";
import { ContractDetailsCard, ContractBodyCard } from "@/components/contracts/contract-document-view";
import { ContractLifecycleControls } from "@/components/contracts/contract-lifecycle-controls";
import { ContractInternalNotesForm } from "@/components/contracts/contract-internal-notes-form";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { TimelineActivityItem } from "@/components/timeline/timeline-activity-item";
import { formatActivity, type ActivityDisplayModel } from "@/lib/activity/format-activity";

/**
 * Contracts Phase 2 (Staff UI) §17–§19 — the Contract detail/hub page.
 * getContractForStaff() is isUuid()-guarded and organizationId-scoped
 * (Phase 1) — a malformed id, a foreign-org id, and a nonexistent id are
 * all identically notFound() here, exactly like every other record
 * detail page's own established convention in this app.
 *
 * Party display (§19, critical): the "Contract details" card (now
 * ContractDetailsCard, see contract-document-view.tsx) always shows the
 * CURRENT relational Client/Project/signatory link (never frozen). A
 * separate "Sent party details" card only appears once the Contract has
 * actually been sent, and only ever renders the three stored snapshots
 * — never live Client/Organization/contact data re-labeled as "what was
 * sent." This is the one place the snapshot invariant (locked
 * architecture §9/§19) is made visible to a Staff viewer, not just held
 * internally by the domain layer.
 *
 * Documents Slice C — the "Contract details"/"Contract body" cards were
 * extracted into contract-document-view.tsx (ContractDetailsCard/
 * ContractBodyCard) so the new DRAFT-only Preview route
 * (`/contracts/[id]/preview`) can render the exact same markup rather
 * than a second interpretation of the same fields. This page's own
 * section order is unchanged by that extraction.
 */
export default async function ContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { organizationId } = await getCurrentUserOrganization();

  const contract = await getContractForStaff(organizationId, id);
  if (!contract) {
    notFound();
  }

  const [acceptedByUser, acceptedByPortalUser, activityRows] = await Promise.all([
    contract.acceptedByUserId ? prisma.user.findUnique({ where: { id: contract.acceptedByUserId }, select: { name: true } }) : null,
    contract.acceptedByPortalUserId
      ? prisma.portalUser.findUnique({ where: { id: contract.acceptedByPortalUserId }, select: { name: true, email: true } })
      : null,
    prisma.activity.findMany({
      where: { organizationId, entityType: "CONTRACT", entityId: contract.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: { actor: { select: { name: true, email: true } } },
    }),
  ]);

  const activityItems: { id: string; display: ActivityDisplayModel }[] = activityRows.map((row) => ({
    id: row.id,
    display: formatActivity({
      entityType: row.entityType,
      action: row.action,
      metadata: row.metadata,
      actor: row.actor,
      createdAt: row.createdAt,
    }),
  }));

  const wasSent = contract.status !== "DRAFT";
  const organizationSnapshot = wasSent ? parseContractOrganizationSnapshot(contract.organizationSnapshot) : null;
  const clientSnapshot = wasSent ? parseContractClientSnapshot(contract.clientSnapshot) : null;
  const signatorySnapshot =
    wasSent && contract.signatorySnapshot !== null ? parseContractSignatorySnapshot(contract.signatorySnapshot) : null;

  const acceptanceLabel = contract.acceptedByUserId
    ? `Acceptance recorded by ${acceptedByUser?.name ?? "a staff member"}`
    : contract.acceptedByPortalUserId
      ? `Accepted through the client portal${acceptedByPortalUser ? ` by ${acceptedByPortalUser.name} (${acceptedByPortalUser.email})` : ""}`
      : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/contracts" className={ACTION_LINK_CLASSES}>
          ← All contracts
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-text-primary text-2xl font-semibold tracking-tight">{contract.contractNumber}</h1>
          <p className="text-text-secondary mt-1 text-sm">{contract.title}</p>
        </div>
        <div className="flex items-center gap-2">
          <ContractStatusBadge contract={contract} />
          {contract.archivedAt !== null && <StatusBadge status="ARCHIVED" />}
        </div>
      </div>

      <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
        <div className="flex flex-wrap items-center gap-3">
          {contract.status === "DRAFT" && contract.archivedAt === null && (
            <Link
              href={`/contracts/${contract.id}/edit`}
              className="focus-visible:ring-focus-ring rounded-md border border-border-strong bg-surface px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            >
              Edit contract
            </Link>
          )}
          {/* Documents Slice C — isContractPreviewable() computes the
              exact same gate as the "Edit contract"/"Send contract"
              condition above (status === DRAFT && not archived) — kept
              as its own check (not nested inside the block above) so the
              single source of truth lives in status.ts, never
              re-derived inline a second time. Once SENT, the
              authoritative party representation becomes the frozen
              snapshot, so this live-field preview is deliberately never
              offered for any other status. */}
          {isContractPreviewable(contract.status, contract.archivedAt) && (
            <Link
              href={`/contracts/${contract.id}/preview`}
              className="focus-visible:ring-focus-ring rounded-md border border-border-strong bg-surface px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            >
              Preview
            </Link>
          )}
          <ContractLifecycleControls contractId={contract.id} status={contract.status} archivedAt={contract.archivedAt} />
        </div>
      </div>

      <ContractDetailsCard contract={contract} />

      {wasSent && (
        <section className={`p-6 ${CARD_SURFACE_CLASSES}`}>
          <h2 className="text-text-primary text-lg font-semibold">Sent party details</h2>
          <p className="text-text-secondary mt-1 text-sm">
            Frozen at the moment this contract was sent — later changes to the client, organization profile, or contact
            above never alter what is shown here.
          </p>
          <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-text-muted text-xs font-medium">Organization (as sent)</dt>
              <dd className="text-text-primary mt-0.5 text-sm">
                {organizationSnapshot?.ok ? organizationSnapshot.snapshot.legalName : "Unavailable"}
              </dd>
            </div>
            <div>
              <dt className="text-text-muted text-xs font-medium">Client (as sent)</dt>
              <dd className="text-text-primary mt-0.5 text-sm">
                {clientSnapshot?.ok ? clientSnapshot.snapshot.billingName : "Unavailable"}
              </dd>
            </div>
            <div>
              <dt className="text-text-muted text-xs font-medium">Intended signatory (as sent)</dt>
              <dd className="text-text-primary mt-0.5 text-sm">
                {contract.signatorySnapshot === null
                  ? "None"
                  : signatorySnapshot?.ok
                    ? signatorySnapshot.snapshot.name
                    : "Unavailable"}
              </dd>
            </div>
          </dl>
        </section>
      )}

      <ContractBodyCard contract={contract} />

      <section className={`p-6 ${CARD_SURFACE_CLASSES}`}>
        <h2 className="text-text-primary text-lg font-semibold">Lifecycle</h2>
        {/* sentAt/acceptedAt/terminatedAt are real timestamps, not
            date-only columns — formatDateOnlyForDisplay's own UTC-forced
            rendering is for issueDate/effectiveDate/expiresAt only (see
            ContractDetailsCard above); a real moment-in-time is shown in
            the viewer's own local time via toLocaleString(), matching
            TimelineActivityItem's own identical convention for Activity
            timestamps. */}
        <ul className="text-text-secondary mt-3 space-y-1 text-sm">
          {contract.sentAt && <li>Sent {contract.sentAt.toLocaleString()}</li>}
          {contract.acceptedAt && (
            <li>
              {acceptanceLabel} — {contract.acceptedAt.toLocaleString()}
            </li>
          )}
          {contract.terminatedAt && <li>Terminated {contract.terminatedAt.toLocaleString()}</li>}
          {!contract.sentAt && <li className="text-text-muted">Not yet sent.</li>}
        </ul>
      </section>

      <section className={`p-6 ${CARD_SURFACE_CLASSES}`}>
        <ContractInternalNotesForm contractId={contract.id} initialValue={contract.internalNotes ?? ""} />
      </section>

      <section className={CARD_SURFACE_CLASSES}>
        <div className="p-6 pb-0">
          <h2 className="text-text-primary text-lg font-semibold">Activity</h2>
        </div>
        {activityItems.length === 0 ? (
          <div className="p-6">
            <EmptyState title="Nothing here yet" description="Activity for this contract will appear here." />
          </div>
        ) : (
          <ul className="divide-border-default divide-y">
            {activityItems.map((item) => (
              <TimelineActivityItem key={item.id} display={item.display} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
