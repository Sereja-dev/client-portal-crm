import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentPortalUser } from "@/lib/current-portal-user";
import { getPortalContract } from "@/lib/client-portal/queries";
import { formatDateOnlyForDisplay } from "@/lib/invoices/date-only";
import {
  parseContractOrganizationSnapshot,
  parseContractClientSnapshot,
  parseContractSignatorySnapshot,
} from "@/lib/contracts/snapshot-types";
import { ContractStatusBadge } from "@/components/contracts/contract-status-badge";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { PortalContractAcceptControls } from "@/components/client-portal/portal-contract-accept-controls";

/**
 * Contracts Portal V1 §9–§14. Read-only, customer-facing, mirroring
 * Portal Quote/Invoice detail's own conventions (max-w-2xl card, back
 * link, metadata grid). getPortalContract already scopes by
 * {id, clientId, organizationId, archivedAt: null, visible status} and
 * never selects internalNotes/createdByUserId/raw acceptedByUserId — a
 * malformed id, a foreign-Client/org id, a DRAFT Contract, an archived
 * Contract, and a nonexistent id are all identically notFound() here
 * (§9/§H).
 *
 * Party display (§10, critical): "Contract parties" renders ONLY the
 * three frozen snapshots (organizationSnapshot/clientSnapshot/
 * signatorySnapshot), parsed through the existing strict parsers — never
 * live OrganizationProfile/Client/ClientContact data. A parse failure
 * renders a safe "Unavailable" line, never raw JSON, never a crash.
 */
export default async function PortalContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { clientId, organizationId } = await getCurrentPortalUser();

  const contract = await getPortalContract(clientId, organizationId, id);
  if (!contract) {
    notFound();
  }

  const organizationSnapshot = parseContractOrganizationSnapshot(contract.organizationSnapshot);
  const clientSnapshot = parseContractClientSnapshot(contract.clientSnapshot);
  const signatorySnapshot =
    contract.signatorySnapshot === null ? null : parseContractSignatorySnapshot(contract.signatorySnapshot);

  // getPortalContract only ever returns a Contract with archivedAt: null
  // (§6) — the only remaining condition for showing "Accept contract" is
  // the stored status itself (§15).
  const canAccept = contract.status === "SENT";

  const acceptanceLabel =
    contract.acceptedBy === null
      ? null
      : contract.acceptedBy.kind === "staff"
        ? "Acceptance recorded by the business"
        : contract.acceptedBy.name
          ? `Accepted through the client portal by ${contract.acceptedBy.name}`
          : "Accepted through the client portal";

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/portal/contracts" className={ACTION_LINK_CLASSES}>
        ← Back to contracts
      </Link>

      <div className={`mt-4 space-y-6 p-6 ${CARD_SURFACE_CLASSES}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-text-primary text-xl font-semibold tracking-tight">{contract.contractNumber}</h1>
            <p className="text-text-secondary mt-1 text-sm">{contract.title}</p>
          </div>
          <ContractStatusBadge contract={contract} />
        </div>

        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-text-muted text-xs font-medium tracking-wide uppercase">Issue date</dt>
            <dd className="text-text-primary mt-1">{formatDateOnlyForDisplay(contract.issueDate)}</dd>
          </div>
          <div>
            <dt className="text-text-muted text-xs font-medium tracking-wide uppercase">Effective date</dt>
            <dd className="text-text-primary mt-1">
              {contract.effectiveDate ? formatDateOnlyForDisplay(contract.effectiveDate) : "Upon acceptance"}
            </dd>
          </div>
          <div>
            <dt className="text-text-muted text-xs font-medium tracking-wide uppercase">Expiry date</dt>
            <dd className="text-text-primary mt-1">
              {contract.expiresAt ? formatDateOnlyForDisplay(contract.expiresAt) : "No expiry set"}
            </dd>
          </div>
        </dl>

        <div className="border-border-default border-t pt-6">
          <h2 className="text-text-primary text-sm font-semibold">Contract parties</h2>
          <p className="text-text-secondary mt-1 text-sm">
            Reflects the details as they were at the time this contract was sent.
          </p>
          <dl className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-text-muted text-xs font-medium tracking-wide uppercase">Organization</dt>
              <dd className="text-text-primary mt-1">
                {organizationSnapshot.ok ? organizationSnapshot.snapshot.legalName : "Unavailable"}
              </dd>
            </div>
            <div>
              <dt className="text-text-muted text-xs font-medium tracking-wide uppercase">Client</dt>
              <dd className="text-text-primary mt-1">{clientSnapshot.ok ? clientSnapshot.snapshot.billingName : "Unavailable"}</dd>
            </div>
            <div>
              <dt className="text-text-muted text-xs font-medium tracking-wide uppercase">Intended signatory</dt>
              <dd className="text-text-primary mt-1">
                {contract.signatorySnapshot === null
                  ? "None"
                  : signatorySnapshot?.ok
                    ? signatorySnapshot.snapshot.name
                    : "Unavailable"}
              </dd>
            </div>
          </dl>
        </div>

        <div className="border-border-default border-t pt-6">
          <h2 className="text-text-primary text-sm font-semibold">Contract body</h2>
          <div className="border-border-default bg-surface-recessed mt-3 rounded-md border p-4">
            <p className="text-text-primary max-w-full overflow-x-auto text-sm whitespace-pre-wrap">{contract.body}</p>
          </div>
        </div>

        <div className="border-border-default border-t pt-6">
          <h2 className="text-text-primary text-sm font-semibold">Lifecycle</h2>
          {/* sentAt/acceptedAt/terminatedAt are real timestamps, not
              date-only columns — toLocaleString() in the viewer's own
              local time, matching the Staff detail page's own identical
              convention (see (dashboard)/contracts/[id]/page.tsx). */}
          <ul className="text-text-secondary mt-3 space-y-1 text-sm">
            {contract.sentAt && <li>Sent {contract.sentAt.toLocaleString()}</li>}
            {contract.acceptedAt && (
              <li>
                {acceptanceLabel} — {contract.acceptedAt.toLocaleString()}
              </li>
            )}
            {contract.terminatedAt && <li>Terminated {contract.terminatedAt.toLocaleString()}</li>}
          </ul>
        </div>

        {canAccept && (
          <div className="border-border-default border-t pt-6">
            <PortalContractAcceptControls contractId={contract.id} contractNumber={contract.contractNumber} />
          </div>
        )}
      </div>
    </div>
  );
}
