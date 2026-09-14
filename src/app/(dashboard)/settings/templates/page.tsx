import Link from "next/link";
import { getCurrentMembership } from "@/lib/current-user";
import { listQuoteTemplates } from "@/lib/quote-templates/queries";
import { canManageQuoteTemplates } from "@/lib/quote-templates/authorization";
import { EmptyState } from "@/components/ui/empty-state";
import type { RawSearchParams } from "@/lib/list-params";
import { QuoteTemplateStatusTabs } from "@/components/quote-templates/quote-template-status-tabs";
import { QuoteTemplateList, type QuoteTemplateRow } from "@/components/quote-templates/quote-template-list";
import { parseQuoteTemplateStatusParam } from "./view-params";
import { archiveQuoteTemplateAction, restoreQuoteTemplateAction, duplicateQuoteTemplateAction } from "./actions";

const PRIMARY_LINK_CLASSES =
  "focus-visible:ring-focus-ring rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

/**
 * Quote Templates Phase 2 (Section A/B) — Settings → Templates list.
 * OWNER/ADMIN-only, exactly mirroring the Phase 1 domain layer's own
 * gate: rendered as an EmptyState "Not available" for a MEMBER — never a
 * redirect, never a 404 — matching WorkflowAutomationsSettingsPage's own
 * identical discipline (that page's own list call itself returns
 * FORBIDDEN for a MEMBER; listQuoteTemplates has no such gate of its own
 * since it's a plain read used by more than just this privileged page,
 * so the check is made explicitly here instead, before it is ever
 * called — same "gate the page, not just the action" outcome).
 *
 * listQuoteTemplates's own `includeArchived` option returns active+
 * archived TOGETHER, not "archived only" — there is no dedicated
 * archived-only query in Phase 1 (queries.ts is deliberately minimal; see
 * that file's own header comment), so the archived tab fetches the full
 * set once and filters to archivedAt !== null here. This is plain
 * array filtering on already-fetched data, not a second implementation
 * of any business rule Phase 1 already owns.
 */
export default async function QuoteTemplatesSettingsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { organizationId, membership } = await getCurrentMembership();

  if (!canManageQuoteTemplates(membership.role)) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <EmptyState title="Not available" description="You don't have permission to view quote templates." />
      </div>
    );
  }

  const resolvedSearchParams = await searchParams;
  const status = parseQuoteTemplateStatusParam(resolvedSearchParams);

  const templates = await listQuoteTemplates(organizationId, { includeArchived: true });
  const visible = status === "archived" ? templates.filter((t) => t.archivedAt !== null) : templates.filter((t) => t.archivedAt === null);

  const rows: QuoteTemplateRow[] = visible.map((template) => ({
    id: template.id,
    name: template.name,
    title: template.title,
    currency: template.currency,
    itemCount: template.items.length,
    validityDays: template.validityDays,
    archived: template.archivedAt !== null,
  }));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Quote templates</h1>
          <p className="text-text-secondary mt-1 text-sm">
            Reusable starting points for new quotes — title, notes, currency, discount, tax, and line items.
          </p>
        </div>
        <Link href="/settings/templates/new" className={PRIMARY_LINK_CLASSES}>
          New template
        </Link>
      </div>

      <QuoteTemplateStatusTabs status={status} />

      {rows.length === 0 ? (
        status === "archived" ? (
          <EmptyState title="No archived templates" description="Templates you archive will appear here." />
        ) : (
          <EmptyState
            title="No quote templates yet"
            description="Create a template to reuse common quote content — title, notes, discount, tax, and line items — as a starting point for new quotes."
            action={
              <Link href="/settings/templates/new" className={PRIMARY_LINK_CLASSES}>
                Create template
              </Link>
            }
          />
        )
      ) : (
        <QuoteTemplateList
          templates={rows}
          archiveAction={archiveQuoteTemplateAction}
          restoreAction={restoreQuoteTemplateAction}
          duplicateAction={duplicateQuoteTemplateAction}
        />
      )}
    </div>
  );
}
