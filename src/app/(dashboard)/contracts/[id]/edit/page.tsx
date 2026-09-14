import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { getContractForStaff } from "@/lib/contracts/queries";
import { formatDateOnly } from "@/lib/invoices/date-only";
import { ContractForm } from "@/components/contracts/contract-form";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { updateContractDocumentAction } from "../../actions";

/**
 * Contracts Phase 2 (Staff UI) — DRAFT-only document edit. Page-level
 * gate here is defense in depth only; updateContractDocument() itself is
 * the real, re-checked-at-commit-time authority (locked architecture
 * §20) — a stale Edit link or a hand-typed URL that races a concurrent
 * send/archive still gets a safe, controlled NOT_EDITABLE result from
 * the form's own submit handler, never a silent overwrite.
 *
 * getContractForStaff() is isUuid()-guarded and organizationId-scoped
 * (Phase 1), so a malformed id, a foreign-org id, and a nonexistent id
 * are all identically notFound() here.
 */
export default async function EditContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { organizationId } = await getCurrentUserOrganization();

  const contract = await getContractForStaff(organizationId, id);
  if (!contract) {
    notFound();
  }
  if (contract.archivedAt !== null) {
    redirect(`/contracts/${id}`);
  }
  if (contract.status !== "DRAFT") {
    redirect(`/contracts/${id}`);
  }

  const [clients, projects, contacts] = await Promise.all([
    prisma.client.findMany({ where: { organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.project.findMany({ where: { organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true, clientId: true } }),
    prisma.clientContact.findMany({
      where: { organizationId, archivedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, clientId: true },
    }),
  ]);

  const boundUpdateAction = updateContractDocumentAction.bind(null, contract.id);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Edit contract</h1>
        <Link href={`/contracts/${contract.id}`} className={ACTION_LINK_CLASSES}>
          Cancel
        </Link>
      </div>
      <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
        <ContractForm
          action={boundUpdateAction}
          clients={clients}
          projects={projects}
          signatories={contacts}
          defaultValues={{
            contractNumber: contract.contractNumber,
            clientId: contract.clientId,
            projectId: contract.projectId ?? undefined,
            signatoryContactId: contract.signatoryContactId ?? undefined,
            title: contract.title,
            body: contract.body,
            issueDate: formatDateOnly(contract.issueDate),
            effectiveDate: contract.effectiveDate ? formatDateOnly(contract.effectiveDate) : undefined,
            expiresAt: contract.expiresAt ? formatDateOnly(contract.expiresAt) : undefined,
          }}
          submitLabel="Save changes"
          pendingLabel="Saving…"
          successToast="Contract updated"
          cancelHref={`/contracts/${contract.id}`}
        />
      </div>
    </div>
  );
}
