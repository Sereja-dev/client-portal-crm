import Link from "next/link";
import { getCurrentMembership } from "@/lib/current-user";
import { listContractTemplates } from "@/lib/contract-templates/queries";
import { canManageContractTemplates } from "@/lib/contract-templates/authorization";
import { EmptyState } from "@/components/ui/empty-state";
import type { RawSearchParams } from "@/lib/list-params";
import { ContractTemplateStatusTabs } from "@/components/contract-templates/contract-template-status-tabs";
import { ContractTemplateList, type ContractTemplateRow } from "@/components/contract-templates/contract-template-list";
import { parseContractTemplateStatusParam } from "./view-params";
import { archiveContractTemplateAction, restoreContractTemplateAction, duplicateContractTemplateAction } from "./actions";

const PRIMARY_LINK_CLASSES =
  "focus-visible:ring-focus-ring rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

/**
 * Contract Templates V1 — Settings → Contract templates list. A NEW,
 * sibling route to /settings/templates (Quote Templates) and
 * /settings/invoice-templates — deliberately not merged into either
 * (Product Owner decision; see ContractTemplate's own schema comment).
 * OWNER/ADMIN-only, exactly mirroring the domain layer's own gate:
 * rendered as an EmptyState "Not available" for a MEMBER — never a
 * redirect, never a 404 — matching InvoiceTemplatesSettingsPage's own
 * identical discipline.
 *
 * listContractTemplates's own `includeArchived` option returns active+
 * archived TOGETHER, not "archived only" — there is no dedicated
 * archived-only query (queries.ts is deliberately minimal), so the
 * archived tab fetches the full set once and filters to archivedAt !==
 * null here. Plain array filtering on already-fetched data, not a
 * second implementation of any business rule the domain layer already
 * owns.
 */
export default async function ContractTemplatesSettingsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { organizationId, membership } = await getCurrentMembership();

  if (!(await canManageContractTemplates(organizationId, membership.role))) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <EmptyState title="Not available" description="You don't have permission to view contract templates." />
      </div>
    );
  }

  const resolvedSearchParams = await searchParams;
  const status = parseContractTemplateStatusParam(resolvedSearchParams);

  const templates = await listContractTemplates(organizationId, { includeArchived: true });
  const visible = status === "archived" ? templates.filter((t) => t.archivedAt !== null) : templates.filter((t) => t.archivedAt === null);

  const rows: ContractTemplateRow[] = visible.map((template) => ({
    id: template.id,
    name: template.name,
    title: template.title,
    defaultExpiryOffsetDays: template.defaultExpiryOffsetDays,
    archived: template.archivedAt !== null,
  }));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Contract templates</h1>
          <p className="text-text-secondary mt-1 text-sm">
            Reusable starting points for new contracts — title, body, default expiry, and internal notes.
          </p>
        </div>
        <Link href="/settings/contract-templates/new" className={PRIMARY_LINK_CLASSES}>
          New template
        </Link>
      </div>

      <ContractTemplateStatusTabs status={status} />

      {rows.length === 0 ? (
        status === "archived" ? (
          <EmptyState title="No archived templates" description="Templates you archive will appear here." />
        ) : (
          <EmptyState
            title="No contract templates yet"
            description="Create a template to reuse common contract content — title, body, default expiry, and internal notes — as a starting point for new contracts."
            action={
              <Link href="/settings/contract-templates/new" className={PRIMARY_LINK_CLASSES}>
                Create template
              </Link>
            }
          />
        )
      ) : (
        <ContractTemplateList
          templates={rows}
          archiveAction={archiveContractTemplateAction}
          restoreAction={restoreContractTemplateAction}
          duplicateAction={duplicateContractTemplateAction}
        />
      )}
    </div>
  );
}
