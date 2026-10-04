import Link from "next/link";
import { formatDateOnlyForDisplay } from "@/lib/invoices/date-only";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import type { ContractWithClient } from "@/lib/contracts/queries";

/**
 * Contracts Phase 2 (Staff UI) / Documents Slice C — the "Contract
 * details" and "Contract body" cards, extracted verbatim from the
 * detail page (`/contracts/[id]/page.tsx`) so the DRAFT Preview route
 * (`/contracts/[id]/preview`) renders the exact same markup/semantics
 * rather than a second, independently-maintained interpretation of the
 * same fields. This is a pure rendering extraction — no field, label, or
 * link target changed from what the detail page already rendered.
 *
 * Kept as two separate components (not one combined block) specifically
 * so the detail page's own existing section ORDER is completely
 * unaffected by this extraction: it still renders "Contract details",
 * then (only when sent) "Sent party details", then "Contract body" —
 * exactly as before. The Preview route renders both back to back
 * instead, with nothing in between.
 *
 * Deliberately NOT extended to cover the detail page's "Sent party
 * details" (frozen SEND snapshots), "Lifecycle", internal notes, or
 * Activity sections — those are either post-SEND-only or Staff
 * management metadata that never belongs in a document preview (see
 * the Preview route's own header comment). Both components always
 * render the CURRENT live Client/Project/signatory/body relation,
 * exactly like the detail page's own cards already do for every status
 * — neither has any awareness of SEND snapshots at all, and neither
 * must ever be reused anywhere a frozen-snapshot reading is required
 * (e.g. the Portal, which renders its own separate snapshot-only view).
 */
export function ContractDetailsCard({ contract }: { contract: ContractWithClient }) {
  return (
    <section className={`p-6 ${CARD_SURFACE_CLASSES}`}>
      <h2 className="text-text-primary text-lg font-semibold">Contract details</h2>
      <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-text-muted text-xs font-medium">Client</dt>
          <dd className="text-text-primary mt-0.5 text-sm">
            <Link href={`/clients/${contract.client.id}`} className={ACTION_LINK_CLASSES}>
              {contract.client.name}
            </Link>
          </dd>
        </div>
        <div>
          <dt className="text-text-muted text-xs font-medium">Project</dt>
          <dd className="text-text-primary mt-0.5 text-sm">
            {contract.project ? (
              <Link href={`/projects/${contract.project.id}`} className={ACTION_LINK_CLASSES}>
                {contract.project.name}
              </Link>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div>
          <dt className="text-text-muted text-xs font-medium">Intended signatory</dt>
          <dd className="text-text-primary mt-0.5 text-sm">
            {contract.signatoryContact ? (
              <>
                {contract.signatoryContact.name}
                {contract.signatoryContact.role ? ` (${contract.signatoryContact.role})` : ""}
                {contract.signatoryContact.archivedAt !== null && (
                  <span className="text-text-muted ml-2 text-xs">Archived contact</span>
                )}
              </>
            ) : (
              "None"
            )}
          </dd>
        </div>
        <div>
          <dt className="text-text-muted text-xs font-medium">Issue date</dt>
          <dd className="text-text-primary mt-0.5 text-sm">{formatDateOnlyForDisplay(contract.issueDate)}</dd>
        </div>
        <div>
          <dt className="text-text-muted text-xs font-medium">Effective date</dt>
          <dd className="text-text-primary mt-0.5 text-sm">
            {contract.effectiveDate ? formatDateOnlyForDisplay(contract.effectiveDate) : "Upon acceptance"}
          </dd>
        </div>
        <div>
          <dt className="text-text-muted text-xs font-medium">Expiry date</dt>
          <dd className="text-text-primary mt-0.5 text-sm">
            {contract.expiresAt ? formatDateOnlyForDisplay(contract.expiresAt) : "No expiry set"}
          </dd>
        </div>
      </dl>
    </section>
  );
}

export function ContractBodyCard({ contract }: { contract: ContractWithClient }) {
  return (
    <section className={`p-6 ${CARD_SURFACE_CLASSES}`}>
      <h2 className="text-text-primary text-lg font-semibold">Contract body</h2>
      <div className="border-border-default bg-surface-recessed mt-3 rounded-md border p-4">
        <p className="text-text-primary max-w-full overflow-x-auto text-sm whitespace-pre-wrap">{contract.body}</p>
      </div>
    </section>
  );
}
