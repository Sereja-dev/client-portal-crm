import Link from "next/link";
import { getCurrentUserOrganization } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { InvoiceForm } from "@/components/invoices/invoice-form";
import { EmptyState } from "@/components/ui/empty-state";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { getCompanyProfile } from "@/lib/organization-setup/company-profile";
import { resolveInvoiceCurrencyDefault, getSupportedInvoiceCurrencies } from "@/lib/invoices/currencies";
import { formatDateOnly } from "@/lib/invoices/date-only";
import { resolveClientPrefill } from "@/lib/clients/resolve-prefill";
import { parseSearchParam, type RawSearchParams } from "@/lib/list-params";
import { createInvoiceAction } from "./actions";

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  // Authentication resolved first, standalone — organizationId is never
  // referenced inside a Promise.all that is still awaiting this.
  const { organizationId } = await getCurrentUserOrganization();
  const resolvedSearchParams = await searchParams;

  // Quotes / Estimates Phase 2.3 — Client REQUIRED, Project OPTIONAL
  // (Invoice / Project Coupling Audit). Every Client is a valid Invoice
  // target regardless of whether the org has any Projects at all — the
  // old "You need a project first" gate (which blocked Invoice creation
  // entirely whenever the org had zero Projects) is removed.
  //
  // Leads Pipeline V1 (Section 21) — an optional post-conversion
  // ?clientId= prefill, resolved the same tenant-scoped way as
  // /projects/new and /quotes/new (resolveClientPrefill). Absent, or an
  // invalid/foreign-org id, both leave this page's own existing
  // behavior completely unchanged.
  const [clients, projects, companyProfile, prefillClient] = await Promise.all([
    prisma.client.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.project.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, clientId: true },
    }),
    getCompanyProfile(organizationId),
    resolveClientPrefill(organizationId, parseSearchParam(resolvedSearchParams.clientId)),
  ]);

  const currencyDefault = resolveInvoiceCurrencyDefault(companyProfile.currency);

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-text-primary text-2xl font-semibold tracking-tight">
          Add invoice
        </h1>
        <Link href="/invoices" className={ACTION_LINK_CLASSES}>
          Cancel
        </Link>
      </div>

      {clients.length === 0 ? (
        <EmptyState
          title="You need a client first"
          description="Invoices must belong to a client. Add one before creating an invoice."
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
          <InvoiceForm
            action={createInvoiceAction}
            clients={clients}
            projects={projects.map((project) => ({ id: project.id, label: project.name, clientId: project.clientId }))}
            currencyOptions={getSupportedInvoiceCurrencies()}
            currencyFallbackNotice={
              currencyDefault.isFallback && currencyDefault.organizationCurrency
                ? `Your organization's currency (${currencyDefault.organizationCurrency}) isn't supported for invoices — defaulted to USD.`
                : undefined
            }
            defaultValues={{
              mode: "flat",
              currency: currencyDefault.currency,
              issueDate: formatDateOnly(new Date()),
              discountType: "NONE",
              taxLabel: "TAX",
              ...(prefillClient ? { clientId: prefillClient.id } : {}),
            }}
          />
        </div>
      )}
    </div>
  );
}
