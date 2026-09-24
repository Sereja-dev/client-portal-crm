import Link from "next/link";
import type { ReactNode } from "react";
import { formatCurrency } from "@/lib/format";
import { formatDateOnlyForDisplay } from "@/lib/invoices/date-only";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import type {
  UpcomingOrOverdueTask,
  NeedsAttentionInvoice,
  NeedsAttentionContract,
} from "@/app/(dashboard)/dashboard/query";

const itemLinkClass =
  "text-text-primary focus-visible:ring-focus-ring rounded text-sm font-medium hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

const countBadgeClass =
  "bg-surface-muted text-text-secondary inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-xs font-medium";

function CategoryCard({
  title,
  count,
  emptyLabel,
  viewAllHref,
  children,
}: {
  title: string;
  count: number;
  emptyLabel: string;
  viewAllHref?: string;
  children: ReactNode;
}) {
  return (
    <section className={`p-6 ${CARD_SURFACE_CLASSES}`}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-text-primary text-sm font-semibold">{title}</h3>
          <span className={countBadgeClass}>{count}</span>
        </div>
        {count > 0 && viewAllHref && (
          <Link href={viewAllHref} className="focus-visible:ring-focus-ring rounded text-text-secondary text-xs font-medium hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2">
            View all
          </Link>
        )}
      </div>
      {count === 0 ? <p className="text-text-muted text-sm">{emptyLabel}</p> : children}
    </section>
  );
}

/**
 * Dashboard Redesign — the operational "Needs Attention" section: three
 * bounded categories (overdue tasks, overdue invoices, unsigned
 * contracts), each showing a count plus its own top ~5 rows. When all
 * three are empty, renders one compact positive empty state instead of
 * three empty cards (locked spec §8) — never an oversized empty shell.
 */
export function NeedsAttention({
  overdueTasksCount,
  overdueTasks,
  overdueInvoicesCount,
  overdueInvoices,
  unsignedContractsCount,
  unsignedContracts,
}: {
  overdueTasksCount: number;
  overdueTasks: UpcomingOrOverdueTask[];
  overdueInvoicesCount: number;
  overdueInvoices: NeedsAttentionInvoice[];
  unsignedContractsCount: number;
  unsignedContracts: NeedsAttentionContract[];
}) {
  const allEmpty = overdueTasksCount === 0 && overdueInvoicesCount === 0 && unsignedContractsCount === 0;

  return (
    <div>
      <h2 className="text-text-primary text-lg font-semibold tracking-tight">Needs attention</h2>

      {allEmpty ? (
        <div className={`mt-4 p-6 text-center ${CARD_SURFACE_CLASSES}`}>
          <p className="text-text-secondary text-sm">Nothing needs attention right now.</p>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <CategoryCard
            title="Overdue tasks"
            count={overdueTasksCount}
            emptyLabel="No overdue tasks."
            viewAllHref="/tasks?overdue=true"
          >
            <ul className="divide-border-default divide-y">
              {overdueTasks.map((task) => (
                <li key={task.id} className="py-3 first:pt-0 last:pb-0">
                  <Link href={`/tasks/${task.id}/edit`} className={itemLinkClass}>
                    {task.title}
                  </Link>
                  <p className="text-text-muted text-sm">{task.projectName}</p>
                  <p className="text-danger mt-0.5 text-xs">Due {formatDateOnlyForDisplay(task.dueDate)}</p>
                </li>
              ))}
            </ul>
          </CategoryCard>

          <CategoryCard
            title="Overdue invoices"
            count={overdueInvoicesCount}
            emptyLabel="No overdue invoices."
            viewAllHref="/invoices"
          >
            <ul className="divide-border-default divide-y">
              {overdueInvoices.map((invoice) => (
                <li key={invoice.id} className="py-3 first:pt-0 last:pb-0">
                  <Link href={`/invoices/${invoice.id}/edit`} className={itemLinkClass}>
                    {invoice.invoiceNumber}
                  </Link>
                  <p className="text-text-muted text-sm">
                    {invoice.clientName} · {formatCurrency(invoice.amount, invoice.currency)}
                  </p>
                  <p className="text-danger mt-0.5 text-xs">Due {formatDateOnlyForDisplay(invoice.dueDate)}</p>
                </li>
              ))}
            </ul>
          </CategoryCard>

          <CategoryCard
            title="Unsigned contracts"
            count={unsignedContractsCount}
            emptyLabel="No unsigned contracts."
            viewAllHref="/contracts"
          >
            <ul className="divide-border-default divide-y">
              {unsignedContracts.map((contract) => (
                <li key={contract.id} className="py-3 first:pt-0 last:pb-0">
                  <Link href={`/contracts/${contract.id}`} className={itemLinkClass}>
                    {contract.title}
                  </Link>
                  <p className="text-text-muted text-sm">{contract.clientName}</p>
                  {contract.sentAt && (
                    <p className="text-text-muted mt-0.5 text-xs">Sent {contract.sentAt.toLocaleDateString()}</p>
                  )}
                </li>
              ))}
            </ul>
          </CategoryCard>
        </div>
      )}
    </div>
  );
}
