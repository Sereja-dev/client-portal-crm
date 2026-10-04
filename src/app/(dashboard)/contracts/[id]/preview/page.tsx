import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { getContractForStaff } from "@/lib/contracts/queries";
import { isContractPreviewable } from "@/lib/contracts/status";
import { ContractDetailsCard, ContractBodyCard } from "@/components/contracts/contract-document-view";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";

/**
 * Documents Slice C — Contract Preview V1. "Live persisted-draft
 * preview": a read-only view of an already-created Contract's CURRENT
 * persisted DRAFT fields, so Staff can inspect the document before
 * pressing Send. This route performs NO write of any kind — not a
 * status change, not a snapshot, not a PDF, not an Activity row, not a
 * stored preview artifact. A plain GET of this page is indistinguishable
 * from never having loaded it at all, as far as the database is
 * concerned (see test/integration/contracts/preview.test.ts's own
 * "no mutation" assertions).
 *
 * Access rules, in order:
 *  1. getContractForStaff() is isUuid()-guarded and organizationId-scoped
 *     (Contracts Phase 1) — a malformed id, a foreign-org id, and a
 *     nonexistent id are all identically notFound() here, exactly like
 *     the detail page and the Edit page already establish.
 *  2. Archived, or any status other than DRAFT, redirects back to the
 *     ordinary detail page — mirrors EditContractPage's own identical
 *     "exists, but not accessible in this state" convention (that page
 *     redirects rather than notFound()s for the same two conditions).
 *     This is intentionally never silently offered for SENT/ACCEPTED/
 *     TERMINATED: once sent, the authoritative party representation is
 *     the frozen snapshot (organizationSnapshot/clientSnapshot/
 *     signatorySnapshot), not the live Client/Project/signatory
 *     relation this route renders — reusing this live-field view past
 *     that point would silently misrepresent what was actually sent.
 *
 * Rendering reuse: ContractDetailsCard/ContractBodyCard are the exact
 * same components the Staff detail page itself renders (extracted from
 * it, not duplicated) — this route is not a second interpretation of
 * Contract body/content. Deliberately excludes internalNotes, Activity,
 * lifecycle timestamps, createdBy metadata, raw snapshots, and any
 * Contract Template lineage (Contract stores none of the latter at all
 * — see ContractTemplate's own schema comment) — this is a document
 * preview, not a management view.
 *
 * No Portal access: this route lives entirely under the `(dashboard)`
 * route group, whose layout already redirects any Portal-only identity
 * to `/portal` before this page's own code ever runs — the same
 * boundary every other Staff-only Contract route already relies on.
 */
export default async function ContractPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { organizationId } = await getCurrentUserOrganization();

  const contract = await getContractForStaff(organizationId, id);
  if (!contract) {
    notFound();
  }
  if (!isContractPreviewable(contract.status, contract.archivedAt)) {
    redirect(`/contracts/${id}`);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <Link href={`/contracts/${contract.id}`} className={ACTION_LINK_CLASSES}>
          ← Back to contract
        </Link>
      </div>

      <div>
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Contract preview</h1>
        <p className="text-text-secondary mt-1 text-sm">
          Preview of the current draft. Sending will freeze the contract document content — internal notes,
          activity, and lifecycle history are never part of the document and are not shown here.
        </p>
      </div>

      {/* Contract number + title — the same two identifying fields the
          detail page's own header shows, included here too since this
          route is meant to stand on its own as a document preview. */}
      <div>
        <p className="text-text-muted text-xs font-medium">{contract.contractNumber}</p>
        <h2 className="text-text-primary text-xl font-semibold tracking-tight">{contract.title}</h2>
      </div>

      <ContractDetailsCard contract={contract} />
      <ContractBodyCard contract={contract} />
    </div>
  );
}
