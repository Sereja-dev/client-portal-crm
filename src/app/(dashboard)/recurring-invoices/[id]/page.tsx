import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentMembership } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { getRecurringInvoice } from "@/lib/recurring-invoices/recurring-invoices";
import { isRecurringInvoiceDueToday } from "@/lib/recurring-invoices/generate";
import { composeInvoiceNumberCandidate } from "@/lib/recurring-invoices/numbering";
import { formatDateOnlyForDisplay } from "@/lib/invoices/date-only";
import { formatInvoiceCurrencyAmount } from "@/lib/invoices/currencies";
import { formatStatusLabel } from "@/lib/format";
import { StatusBadge } from "@/components/ui/status-badge";
import { ACTION_LINK_CLASSES } from "@/components/ui/action-link-classes";
import { CARD_SURFACE_CLASSES } from "@/components/ui/surface";
import { Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { PauseResumeButton } from "@/components/recurring-invoices/pause-resume-button";
import { ArchiveButton } from "@/components/recurring-invoices/archive-button";
import { GenerateDueButton } from "@/components/recurring-invoices/generate-due-button";
import {
  pauseRecurringInvoiceAction,
  resumeRecurringInvoiceAction,
  archiveRecurringInvoiceAction,
  generateDueInvoiceAction,
} from "../actions";

const FREQUENCY_LABELS: Record<string, string> = {
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  YEARLY: "Yearly",
};

/**
 * Recurring Invoices Phase 2A — detail page. Scoped by id + organizationId
 * together via getRecurringInvoice — a foreign org's schedule id simply
 * doesn't match, indistinguishable from a nonexistent one. A MEMBER is
 * redirected outright (getRecurringInvoice itself returns FORBIDDEN),
 * matching the list page's own discipline.
 *
 * The "Generate due invoice" button only ever renders when this page's
 * own server-side check (status ACTIVE + isRecurringInvoiceDueToday)
 * passes — generateDueInvoiceAction independently re-verifies the exact
 * same condition regardless, so a stale render can never bypass it.
 *
 * Archived is terminal: no Pause/Resume, no Generate, template shown
 * read-only (no Edit link at all) — generated invoice history remains
 * fully visible regardless of lifecycle state.
 */
export default async function RecurringInvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
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

  const [client, project, generatedInvoices] = await Promise.all([
    prisma.client.findUnique({ where: { id: schedule.clientId }, select: { name: true } }),
    schedule.projectId ? prisma.project.findUnique({ where: { id: schedule.projectId }, select: { name: true } }) : Promise.resolve(null),
    // recurringInvoiceId already uniquely identifies "this schedule's own
    // Invoices," but organizationId is included too as defense in depth —
    // never trust a single-column scope alone when a compound one is this
    // cheap to add.
    prisma.invoice.findMany({
      where: { recurringInvoiceId: schedule.id, organizationId },
      orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
      select: { id: true, invoiceNumber: true, issueDate: true, dueDate: true, status: true, amount: true, currency: true },
    }),
  ]);

  const isArchived = schedule.status === "ARCHIVED";
  const isPaused = schedule.status === "PAUSED";
  const isActive = schedule.status === "ACTIVE";
  const isDueToday = isActive && isRecurringInvoiceDueToday(schedule.nextIssueDate, new Date());
  const numberPreview = composeInvoiceNumberCandidate(schedule.invoiceNumberPrefix, schedule.nextSequence);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-text-primary text-2xl font-semibold tracking-tight">{schedule.name ?? "Untitled schedule"}</h1>
          <div className="mt-1">
            <StatusBadge status={schedule.status} />
          </div>
        </div>
        <Link href="/recurring-invoices" className={ACTION_LINK_CLASSES}>
          Back to recurring invoices
        </Link>
      </div>

      {isArchived && (
        <p className="border-border-strong bg-surface-recessed text-text-secondary mb-4 rounded-md border border-dashed px-4 py-3 text-sm">
          This schedule is archived — it can no longer generate invoices and cannot be resumed. Already-generated invoices below are unaffected.
        </p>
      )}

      <div className={`p-6 ${CARD_SURFACE_CLASSES}`}>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-text-muted text-xs font-medium tracking-wide uppercase">Client</dt>
            <dd className="text-text-primary mt-0.5">{client?.name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-text-muted text-xs font-medium tracking-wide uppercase">Project</dt>
            <dd className="text-text-primary mt-0.5">{project?.name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-text-muted text-xs font-medium tracking-wide uppercase">Frequency</dt>
            <dd className="text-text-primary mt-0.5">{FREQUENCY_LABELS[schedule.frequency] ?? formatStatusLabel(schedule.frequency)}</dd>
          </div>
          <div>
            <dt className="text-text-muted text-xs font-medium tracking-wide uppercase">Next issue date</dt>
            <dd className="text-text-primary mt-0.5">{formatDateOnlyForDisplay(schedule.nextIssueDate)}</dd>
          </div>
          <div>
            <dt className="text-text-muted text-xs font-medium tracking-wide uppercase">Next invoice number</dt>
            <dd className="text-text-primary mt-0.5">{numberPreview}</dd>
          </div>
          <div>
            <dt className="text-text-muted text-xs font-medium tracking-wide uppercase">Due date rule</dt>
            <dd className="text-text-primary mt-0.5">
              {schedule.dueDateOffsetDays === null ? "No due date" : `${schedule.dueDateOffsetDays} days after issue`}
            </dd>
          </div>
          <div>
            <dt className="text-text-muted text-xs font-medium tracking-wide uppercase">Currency</dt>
            <dd className="text-text-primary mt-0.5">{schedule.currency}</dd>
          </div>
          <div>
            <dt className="text-text-muted text-xs font-medium tracking-wide uppercase">Discount</dt>
            <dd className="text-text-primary mt-0.5">
              {schedule.discountType === "NONE"
                ? "None"
                : schedule.discountType === "PERCENTAGE"
                  ? `${schedule.discountValue?.toString()}%`
                  : formatInvoiceCurrencyAmount(schedule.discountValue?.toString() ?? "0", schedule.currency)}
            </dd>
          </div>
          <div>
            <dt className="text-text-muted text-xs font-medium tracking-wide uppercase">Tax</dt>
            <dd className="text-text-primary mt-0.5">
              {schedule.taxRatePercent === null ? "None" : `${schedule.taxRatePercent.toString()}% ${schedule.taxLabel}`}
            </dd>
          </div>
        </dl>

        <div className="mt-4">
          <dt className="text-text-muted text-xs font-medium tracking-wide uppercase">Line items</dt>
          <ul className="mt-2 space-y-1 text-sm">
            {schedule.lineItems.map((item) => (
              <li key={item.id} className="text-text-secondary flex justify-between gap-4">
                <span className="truncate">{item.description}</span>
                <span className="text-text-primary shrink-0">
                  {item.quantity.toString()} × {formatInvoiceCurrencyAmount(item.unitPrice.toString(), schedule.currency) ?? item.unitPrice.toString()}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {schedule.notes && (
          <div className="mt-4">
            <dt className="text-text-muted text-xs font-medium tracking-wide uppercase">Notes</dt>
            <p className="text-text-primary mt-1 text-sm whitespace-pre-wrap">{schedule.notes}</p>
          </div>
        )}
        {schedule.internalNotes && (
          <div className="mt-4">
            <dt className="text-text-muted text-xs font-medium tracking-wide uppercase">Internal notes</dt>
            <p className="text-text-primary mt-1 text-sm whitespace-pre-wrap">{schedule.internalNotes}</p>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
        {!isArchived && (
          <Link href={`/recurring-invoices/${schedule.id}/edit`} className={ACTION_LINK_CLASSES}>
            Edit
          </Link>
        )}
        {isDueToday && <GenerateDueButton recurringInvoiceId={schedule.id} generateAction={generateDueInvoiceAction} />}
        {!isArchived && (
          <PauseResumeButton
            recurringInvoiceId={schedule.id}
            isPaused={isPaused}
            pauseAction={pauseRecurringInvoiceAction}
            resumeAction={resumeRecurringInvoiceAction}
          />
        )}
        {!isArchived && <ArchiveButton recurringInvoiceId={schedule.id} archiveAction={archiveRecurringInvoiceAction} />}
      </div>

      <div className="mt-10">
        <h2 className="text-text-primary text-lg font-semibold tracking-tight">Generated invoices</h2>
        {generatedInvoices.length === 0 ? (
          <EmptyState title="No invoices generated yet" description="Invoices generated from this schedule will appear here." />
        ) : (
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Invoice number</TableHeaderCell>
                <TableHeaderCell>Issue date</TableHeaderCell>
                <TableHeaderCell>Due date</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell align="right">Total</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {generatedInvoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell emphasis>
                    <Link
                      href={`/invoices/${invoice.id}/edit`}
                      className="focus-visible:ring-focus-ring rounded hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                    >
                      {invoice.invoiceNumber}
                    </Link>
                  </TableCell>
                  <TableCell>{formatDateOnlyForDisplay(invoice.issueDate)}</TableCell>
                  <TableCell>{invoice.dueDate ? formatDateOnlyForDisplay(invoice.dueDate) : "—"}</TableCell>
                  <TableCell>
                    <StatusBadge status={invoice.status} />
                  </TableCell>
                  <TableCell align="right">{formatInvoiceCurrencyAmount(invoice.amount.toString(), invoice.currency) ?? invoice.amount.toString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
