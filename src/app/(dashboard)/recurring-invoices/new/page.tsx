import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentMembership } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { getSupportedInvoiceCurrencies } from "@/lib/invoices/currencies";
import { RecurringInvoiceForm } from "@/components/recurring-invoices/recurring-invoice-form";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { createRecurringInvoiceAction } from "../actions";

/**
 * Recurring Invoices Phase 2A — "New schedule". OWNER/ADMIN-only — a
 * MEMBER is redirected outright rather than shown a form that would only
 * ever fail server-side (createRecurringInvoiceAction independently
 * re-verifies this regardless). Matches the same "gate the page, not just
 * the action" discipline as every other privileged-only page in this app.
 */
export default async function NewRecurringInvoicePage() {
  const { organizationId, membership } = await getCurrentMembership();
  if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
    redirect("/recurring-invoices");
  }

  const [clients, projects] = await Promise.all([
    prisma.client.findMany({ where: { organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.project.findMany({ where: { organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true, clientId: true } }),
  ]);

  return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">New recurring invoice</h1>
        <Link href="/recurring-invoices" className={ACTION_LINK_CLASSES}>
          Cancel
        </Link>
      </div>
      <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
        <RecurringInvoiceForm
          mode="create"
          action={createRecurringInvoiceAction}
          clients={clients}
          projects={projects.map((p) => ({ id: p.id, label: p.name, clientId: p.clientId }))}
          currencyOptions={getSupportedInvoiceCurrencies()}
          submitLabel="Create schedule"
          pendingLabel="Creating…"
        />
      </div>
    </div>
  );
}
