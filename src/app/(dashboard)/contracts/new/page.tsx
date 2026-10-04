import Link from "next/link";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { suggestNextContractNumber } from "@/lib/contracts/suggest-next-contract-number";
import { formatDateOnly } from "@/lib/invoices/date-only";
import { ContractForm, type ContractFormDefaults } from "@/components/contracts/contract-form";
import { ContractTemplatePicker } from "@/components/contracts/contract-template-picker";
import { EmptyState } from "@/components/ui/empty-state";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { listContractTemplates } from "@/lib/contract-templates/queries";
import { getContractTemplateDefaults } from "@/lib/contract-templates/apply";
import { parseSearchParam, type RawSearchParams } from "@/lib/list-params";
import { createContractAction, updateContractInternalNotesAction } from "../actions";

/**
 * Contracts Phase 2 (Staff UI) — "New contract". Client required (locked
 * architecture §1/§10); no lifecycle/status/snapshot/actor controls of
 * any kind (createContract() always creates DRAFT server-side — locked
 * architecture §8). Every Staff role may create a contract, so unlike
 * NewQuoteTemplatePage/NewInvoiceTemplatePage this page has no role gate
 * at all.
 *
 * Contract Templates V1 (Documents Slice B) — `?templateId=<id>` prefill,
 * layered onto the existing, otherwise byte-identical blank-Contract flow.
 * Mirrors src/app/(dashboard)/invoices/new/page.tsx's own identical
 * `?templateId=` integration exactly (see that file's own header comment
 * for the full reasoning this one reuses verbatim below).
 *
 * ONE authoritative `now` — a single `new Date()` call for the whole
 * request, reused for BOTH the blank issueDate default and
 * getContractTemplateDefaults's own expiresAt computation, so "issue date
 * + defaultExpiryOffsetDays" always means exactly what it says with no
 * possible off-by-one from two separately-evaluated timestamps straddling
 * a UTC midnight rollover (locked architecture §9 — expiry is always
 * relative to issueDate, never effectiveDate).
 *
 * getContractTemplateDefaults already resolves {organizationId,
 * membership} itself from the session and already permits any Staff role
 * currently allowed to create a Contract (canApplyContractTemplates) —
 * this page never re-derives or narrows that check.
 *
 * A missing template param leaves every line below the `now` declaration
 * exactly as it was before this feature (`templateId` is `""`,
 * `templateResult` stays `null`, `templateDefaults` stays `undefined`) —
 * the blank-Contract flow is unchanged.
 *
 * An archived / foreign-org / nonexistent / malformed template id are all
 * indistinguishable NOT_FOUND results from getContractTemplateDefaults
 * itself — this page never learns, and therefore can never leak, which
 * one it was. All four render the exact same generic "Template
 * unavailable" notice plus an ordinary blank form — a stale template URL
 * never makes the whole page unusable.
 *
 * There is no `?clientId=`/`?projectId=` prefill on this page at all
 * (confirmed — unlike /invoices/new and /quotes/new, no such mechanism
 * exists here), so there is nothing else for template defaults to
 * compose with: contractNumber/Client/Project/signatory/issueDate are
 * always the ordinary blank-flow defaults regardless of which template
 * (if any) is applied. Template defaults never set any of those — Product
 * Owner decision, ContractTemplate stores none of them (see
 * ContractTemplate's own schema comment).
 */
export default async function NewContractPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { organizationId } = await getCurrentUserOrganization();
  const resolvedSearchParams = await searchParams;
  const templateId = parseSearchParam(resolvedSearchParams.templateId);

  const now = new Date();

  const [clients, projects, contacts, suggestedNumber, activeTemplates, templateResult] = await Promise.all([
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
    // Active only — never offered for selection here even though
    // getActiveContractTemplateForApply would independently reject an
    // archived one anyway; this keeps the picker itself from ever
    // listing something it (or a forged URL) can't actually apply.
    listContractTemplates(organizationId, { includeArchived: false }),
    templateId ? getContractTemplateDefaults(templateId, now) : Promise.resolve(null),
  ]);

  // A template id was present in the URL but could not be applied
  // (archived / foreign-org / nonexistent / malformed — all
  // indistinguishable, see this file's own header comment). Never shown
  // when no template param was given at all.
  const templateUnavailable = Boolean(templateId) && templateResult?.ok !== true;
  const appliedTemplateId = templateResult?.ok ? templateId : null;

  // Merged into ContractForm's own defaultValues below — only the
  // documented prefill fields are ever read here: title/body/expiresAt/
  // internalNotes. No Client/Project/signatory, contractNumber, or
  // issueDate ever comes from a template (locked architecture §6/§7).
  const templateDefaults: Partial<ContractFormDefaults> | undefined = templateResult?.ok
    ? {
        title: templateResult.defaults.title,
        body: templateResult.defaults.body,
        expiresAt: templateResult.defaults.expiresAt ?? undefined,
        internalNotes: templateResult.defaults.internalNotes ?? undefined,
      }
    : undefined;

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
        <>
          <ContractTemplatePicker
            templates={activeTemplates.map((template) => ({ id: template.id, name: template.name }))}
            selectedTemplateId={appliedTemplateId ?? undefined}
          />

          {templateUnavailable && (
            <div className="border-warning bg-warning-subtle text-warning mb-6 rounded-md border px-4 py-3 text-sm" role="status">
              This contract template is unavailable. Starting with a blank contract instead.
            </div>
          )}

          <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
            <ContractForm
              // Remounts whenever the applied template changes (including
              // to/from "no template") so ContractForm's own useState
              // initializers re-read the new defaultValues — React does
              // not otherwise re-run those initializers on a prop change
              // alone. See contract-template-picker.tsx's own header
              // comment, and invoice-template-picker.tsx's own identical
              // precedent.
              key={appliedTemplateId ?? "blank"}
              action={createContractAction}
              onSavedInternalNotes={updateContractInternalNotesAction}
              clients={clients}
              projects={projects}
              signatories={contacts}
              defaultValues={{
                contractNumber: suggestedNumber,
                issueDate: formatDateOnly(now),
                ...templateDefaults,
              }}
              submitLabel="Create contract"
              pendingLabel="Creating…"
              successToast="Contract created"
              cancelHref="/contracts"
            />
          </div>
        </>
      )}
    </div>
  );
}
