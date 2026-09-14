import Link from "next/link";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { suggestNextContractNumber } from "@/lib/contracts/suggest-next-contract-number";
import { formatDateOnly } from "@/lib/invoices/date-only";
import { ContractForm } from "@/components/contracts/contract-form";
import { EmptyState } from "@/components/ui/empty-state";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { createContractAction, updateContractInternalNotesAction } from "../actions";

/**
 * Contracts Phase 2 (Staff UI) — "New contract". Client required (locked
 * architecture §1/§10); no lifecycle/status/snapshot/actor controls of
 * any kind (createContract() always creates DRAFT server-side — locked
 * architecture §8). Every Staff role may create a contract, so unlike
 * NewQuoteTemplatePage this page has no role gate at all.
 */
export default async function NewContractPage() {
  const { organizationId } = await getCurrentUserOrganization();

  const [clients, projects, contacts, suggestedNumber] = await Promise.all([
    prisma.client.findMany({ where: { organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.project.findMany({ where: { organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true, clientId: true } }),
    // Only ACTIVE contacts — an archived ClientContact must never be
    // offered as a NEW signatory selection (locked architecture §12,
    // matches resolveContractSignatory's own identical rule).
    prisma.clientContact.findMany({
      where: { organizationId, archivedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, clientId: true },
    }),
    suggestNextContractNumber(organizationId),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">New contract</h1>
        <Link href="/contracts" className={ACTION_LINK_CLASSES}>
          Cancel
        </Link>
      </div>

      {clients.length === 0 ? (
        <EmptyState
          title="You need a client first"
          description="Contracts must belong to a client. Add one before creating a contract."
          action={
            <Link
              href="/clients/new"
              className="focus-visible:ring-focus-ring rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            >
              Add client
            </Link>
          }
        />
      ) : (
        <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
          <ContractForm
            action={createContractAction}
            onSavedInternalNotes={updateContractInternalNotesAction}
            clients={clients}
            projects={projects}
            signatories={contacts}
            defaultValues={{ contractNumber: suggestedNumber, issueDate: formatDateOnly(new Date()) }}
            submitLabel="Create contract"
            pendingLabel="Creating…"
            successToast="Contract created"
            cancelHref="/contracts"
          />
        </div>
      )}
    </div>
  );
}
