import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentMembership } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { getRecurringInvoice } from "@/lib/recurring-invoices/recurring-invoices";
import { getSupportedInvoiceCurrencies } from "@/lib/invoices/currencies";
import { RecurringInvoiceForm } from "@/components/recurring-invoices/recurring-invoice-form";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { updateRecurringInvoiceAction } from "../../actions";

/**
 * Recurring Invoices Phase 2A — edit. Only ever renders template fields
 * updateRecurringInvoice actually supports — frequency/firstIssueDate/
 * startingSequence are never passed as defaultValues and RecurringInvoiceForm's
 * own mode="edit" never renders inputs for them at all (see that
 * component's own header comment). An archived schedule has no Edit link
 * anywhere in this app (the detail page only renders one when
 * !isArchived) — reachable only via a stale/typed-in URL, so this route
 * still redirects safely rather than trusting that.
 */
export default async function EditRecurringInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, organizationId, membership } = await getCurrentMembership();
  const actor = { id: user.id, name: user.name, role: membership.role };

  const result = await getRecurringInvoice(organizationId, id, actor);
  if (!result.ok) {
    redirect("/recurring-invoices");
  }
  const schedule = result.recurringInvoice;
  if (!schedule) {
    notFound();
  }
  if (schedule.status === "ARCHIVED") {
    redirect(`/recurring-invoices/${id}`);
  }

  const [clients, projects] = await Promise.all([
    prisma.client.findMany({ where: { organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.project.findMany({ where: { organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true, clientId: true } }),
  ]);

  const boundUpdateAction = updateRecurringInvoiceAction.bind(null, schedule.id);

  return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Edit recurring invoice</h1>
        <Link href={`/recurring-invoices/${schedule.id}`} className={ACTION_LINK_CLASSES}>
          Cancel
        </Link>
      </div>
      <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
        <RecurringInvoiceForm
          mode="edit"
          action={boundUpdateAction}
          clients={clients}
          projects={projects.map((p) => ({ id: p.id, label: p.name, clientId: p.clientId }))}
          currencyOptions={getSupportedInvoiceCurrencies()}
          defaultValues={{
            name: schedule.name ?? "",
            clientId: schedule.clientId,
            projectId: schedule.projectId,
            invoiceNumberPrefix: schedule.invoiceNumberPrefix,
            startingSequence: schedule.nextSequence,
            dueDateOffsetDays: schedule.dueDateOffsetDays,
            currency: schedule.currency,
            lineItems: schedule.lineItems.map((item) => ({
              description: item.description,
              quantity: item.quantity.toString(),
              unitPrice: item.unitPrice.toString(),
            })),
            discountType: schedule.discountType,
            discountValue: schedule.discountValue?.toString() ?? "",
            taxRatePercent: schedule.taxRatePercent?.toString() ?? "",
            taxLabel: schedule.taxLabel,
            notes: schedule.notes ?? "",
            internalNotes: schedule.internalNotes ?? "",
          }}
          submitLabel="Save changes"
          pendingLabel="Saving…"
        />
      </div>
    </div>
  );
}
