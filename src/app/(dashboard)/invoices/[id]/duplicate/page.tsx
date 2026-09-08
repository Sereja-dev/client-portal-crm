import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { InvoiceForm } from "@/components/invoices/invoice-form";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { getDuplicateSourceInvoice } from "@/lib/invoices/duplicate-source";
import { buildDuplicateInvoiceDefaults, type DuplicateSourceData } from "@/lib/invoices/duplicate";
import { isSupportedInvoiceCurrency, getSupportedInvoiceCurrencies } from "@/lib/invoices/currencies";
import { requireInvoiceProjectId } from "@/lib/invoices/require-invoice-project";
import { createInvoiceAction } from "../../new/actions";

/**
 * Invoice System — Duplicate-as-new-DRAFT (completing official Slice 2,
 * docs/invoicing-architecture.md §3.2/§14). Opening this page performs
 * zero writes in every branch — it only ever reads the authorized
 * CANCELLED source and (for the eligible-currency case) the org's project
 * list, exactly the same reads `/invoices/new` already performs. The
 * only write happens later, when the user explicitly submits through the
 * ordinary, completely unmodified `createInvoiceAction` — this page never
 * adds a `sourceInvoiceId` or any other source-identity field to the
 * form, so the created invoice is, and always was, an ordinary new
 * invoice; the source is only a page-load prefill snapshot.
 */
export default async function DuplicateInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { organizationId } = await getCurrentUserOrganization();

  const source = await getDuplicateSourceInvoice(id, organizationId);
  if (!source) {
    notFound();
  }

  // Case/whitespace normalization only — never a denomination conversion,
  // never a fallback, and the source row is never written to.
  // isSupportedInvoiceCurrency() would normalize internally regardless,
  // but normalizing here first keeps the value actually passed into the
  // form (below) visibly identical to the value the support check ran
  // against.
  const normalizedCurrency = source.currency.trim().toUpperCase();

  if (!isSupportedInvoiceCurrency(normalizedCurrency)) {
    return (
      <div className="mx-auto max-w-xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-text-primary text-2xl font-semibold tracking-tight">
            Can&rsquo;t duplicate this invoice automatically
          </h1>
          <Link href="/invoices" className={ACTION_LINK_CLASSES}>
            Back
          </Link>
        </div>
        <div className={`text-text-secondary p-6 text-sm ${CARD_SURFACE_CLASSES}`}>
          <p>
            Invoice {source.invoiceNumber}&rsquo;s currency ({source.currency}) isn&rsquo;t supported for new
            invoices, so it can&rsquo;t be duplicated automatically. Create a new invoice manually and choose a
            supported currency instead.
          </p>
          <div className="mt-4 flex gap-4">
            <Link
              href={`/invoices/${source.id}/edit`}
              className="text-text-primary focus-visible:ring-focus-ring rounded text-sm font-medium hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            >
              View original invoice
            </Link>
            <Link
              href="/invoices/new"
              className="text-text-primary focus-visible:ring-focus-ring rounded text-sm font-medium hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            >
              Add invoice
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const projects = await prisma.project.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, client: { select: { name: true } } },
  });

  // Captured exactly once, then injected — the pure mapper below never
  // calls `new Date()` internally.
  const today = new Date();

  const sourceData: DuplicateSourceData = {
    invoiceNumber: source.invoiceNumber,
    // Quotes / Estimates Phase 2.2b — TRANSITIONAL compile-safety narrow
    // (see src/lib/invoices/require-invoice-project.ts's own header
    // comment). getDuplicateSourceInvoice's own scoped query already
    // requires `project: { organizationId }`, so `source.projectId`
    // always has a value.
    projectId: requireInvoiceProjectId(source.projectId, "duplicate invoice page"),
    amount: source.amount.toString(),
    currency: normalizedCurrency,
    notes: source.notes,
    discountType: source.discountType,
    discountValue: source.discountValue?.toString() ?? null,
    taxRatePercent: source.taxRatePercent?.toString() ?? null,
    taxLabel: source.taxLabel,
    lineItems: source.lineItems.map((lineItem) => ({
      description: lineItem.description,
      quantity: lineItem.quantity.toString(),
      unitPrice: lineItem.unitPrice.toString(),
    })),
  };

  const defaults = buildDuplicateInvoiceDefaults(sourceData, today);

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">
          Duplicate invoice
        </h1>
        <Link href="/invoices" className={ACTION_LINK_CLASSES}>
          Cancel
        </Link>
      </div>
      <p className="text-text-secondary -mt-4 mb-6 text-sm">
        Creates a new draft pre-filled from cancelled invoice {source.invoiceNumber}. Review and confirm the
        invoice number before saving.{" "}
        <Link href={`/invoices/${source.id}/edit`} className="text-text-primary font-medium hover:underline">
          View original invoice
        </Link>
        .
      </p>

      {projects.length === 0 ? (
        <p className="text-text-secondary text-sm">You need a project first — add one before duplicating this invoice.</p>
      ) : (
        <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
          <InvoiceForm
            action={createInvoiceAction}
            projects={projects.map((project) => ({
              id: project.id,
              label: `${project.name} — ${project.client.name}`,
            }))}
            currencyOptions={getSupportedInvoiceCurrencies()}
            defaultValues={defaults}
            submitLabel="Create duplicate"
          />
        </div>
      )}
    </div>
  );
}
