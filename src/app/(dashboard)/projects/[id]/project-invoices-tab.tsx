import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateOnlyForDisplay } from "@/lib/invoices/date-only";
import { formatCurrency } from "@/lib/format";
import type { ProjectInvoiceRow } from "./profile-query";
import { PROJECT_TAB_ROW_BOUND } from "./profile-query";

const PRIMARY_LINK_CLASSES =
  "focus-visible:ring-focus-ring rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

/**
 * Project Hub V1 — the Invoices tab. Each row's own `amount`/`currency`
 * are always kept together — never summed across rows into one
 * mixed-currency total (Section 13's own explicit invariant, identical to
 * Client Hub's own Invoices tab). No FX, no aggregate here at all; the
 * Overview's own "Invoices" health card is a COUNT only, for the exact
 * same reason.
 */
export function ProjectInvoicesTab({
  clientId,
  invoices,
}: {
  clientId: string;
  invoices: ProjectInvoiceRow[];
}) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Link href={`/invoices/new?clientId=${clientId}`} className={PRIMARY_LINK_CLASSES}>
          Create invoice
        </Link>
      </div>

      {invoices.length === 0 ? (
        <EmptyState
          title="No invoices yet"
          description="Invoices linked to this project will appear here."
          action={
            <Link href={`/invoices/new?clientId=${clientId}`} className={PRIMARY_LINK_CLASSES}>
              Create invoice
            </Link>
          }
        />
      ) : (
        <ul className="divide-border-subtle border-border-default divide-y rounded-lg border">
          {invoices.map((invoice) => (
            <li key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-text-primary text-sm font-medium">{invoice.invoiceNumber}</p>
                <p className="text-text-secondary mt-1 text-xs">
                  Issued {formatDateOnlyForDisplay(invoice.issueDate)}
                  {invoice.dueDate && ` · Due ${formatDateOnlyForDisplay(invoice.dueDate)}`}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={invoice.status} />
                <span className="text-text-primary text-sm font-medium tabular-nums">
                  {formatCurrency(Number(invoice.amount), invoice.currency)}
                </span>
                <Link href={`/invoices/${invoice.id}/edit`} className="text-accent text-sm hover:underline">
                  View
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}

      {invoices.length === PROJECT_TAB_ROW_BOUND && (
        <p className="text-text-muted text-xs">Showing the most recent {PROJECT_TAB_ROW_BOUND} invoices.</p>
      )}
    </div>
  );
}
