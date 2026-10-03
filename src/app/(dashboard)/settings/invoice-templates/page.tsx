import Link from "next/link";
import { getCurrentMembership } from "@/lib/current-user";
import { listInvoiceTemplates } from "@/lib/invoice-templates/queries";
import { canManageInvoiceTemplates } from "@/lib/invoice-templates/authorization";
import { EmptyState } from "@/components/ui/empty-state";
import type { RawSearchParams } from "@/lib/list-params";
import { InvoiceTemplateStatusTabs } from "@/components/invoice-templates/invoice-template-status-tabs";
import { InvoiceTemplateList, type InvoiceTemplateRow } from "@/components/invoice-templates/invoice-template-list";
import { parseInvoiceTemplateStatusParam } from "./view-params";
import { archiveInvoiceTemplateAction, restoreInvoiceTemplateAction, duplicateInvoiceTemplateAction } from "./actions";

const PRIMARY_LINK_CLASSES =
  "focus-visible:ring-focus-ring rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

/**
 * Invoice Templates V1 — Settings → Invoice templates list. A NEW,
 * sibling route to /settings/templates (Quote Templates) — deliberately
 * not merged into that page (Product Owner decision; see
 * InvoiceTemplate's own schema comment). OWNER/ADMIN-only, exactly
 * mirroring the domain layer's own gate: rendered as an EmptyState "Not
 * available" for a MEMBER — never a redirect, never a 404 — matching
 * QuoteTemplatesSettingsPage's own identical discipline.
 *
 * listInvoiceTemplates's own `includeArchived` option returns active+
 * archived TOGETHER, not "archived only" — there is no dedicated
 * archived-only query (queries.ts is deliberately minimal), so the
 * archived tab fetches the full set once and filters to archivedAt !==
 * null here. Plain array filtering on already-fetched data, not a
 * second implementation of any business rule the domain layer already
 * owns.
 */
export default async function InvoiceTemplatesSettingsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { organizationId, membership } = await getCurrentMembership();

  if (!(await canManageInvoiceTemplates(organizationId, membership.role))) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <EmptyState title="Not available" description="You don't have permission to view invoice templates." />
      </div>
    );
  }

  const resolvedSearchParams = await searchParams;
  const status = parseInvoiceTemplateStatusParam(resolvedSearchParams);

  const templates = await listInvoiceTemplates(organizationId, { includeArchived: true });
  const visible = status === "archived" ? templates.filter((t) => t.archivedAt !== null) : templates.filter((t) => t.archivedAt === null);

  const rows: InvoiceTemplateRow[] = visible.map((template) => ({
    id: template.id,
    name: template.name,
    currency: template.currency,
    itemCount: template.items.length,
    dueDateOffsetDays: template.dueDateOffsetDays,
    archived: template.archivedAt !== null,
  }));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Invoice templates</h1>
          <p className="text-text-secondary mt-1 text-sm">
            Reusable starting points for new invoices — currency, due date, discount, tax, notes, and line items.
          </p>
        </div>
        <Link href="/settings/invoice-templates/new" className={PRIMARY_LINK_CLASSES}>
          New template
        </Link>
      </div>

      <InvoiceTemplateStatusTabs status={status} />

      {rows.length === 0 ? (
        status === "archived" ? (
          <EmptyState title="No archived templates" description="Templates you archive will appear here." />
        ) : (
          <EmptyState
            title="No invoice templates yet"
            description="Create a template to reuse common invoice content — currency, due date, discount, tax, notes, and line items — as a starting point for new invoices."
            action={
              <Link href="/settings/invoice-templates/new" className={PRIMARY_LINK_CLASSES}>
                Create template
              </Link>
            }
          />
        )
      ) : (
        <InvoiceTemplateList
          templates={rows}
          archiveAction={archiveInvoiceTemplateAction}
          restoreAction={restoreInvoiceTemplateAction}
          duplicateAction={duplicateInvoiceTemplateAction}
        />
      )}
    </div>
  );
}
