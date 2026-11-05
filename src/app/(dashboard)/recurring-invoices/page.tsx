import Link from "next/link";
import { getCurrentMembership } from "@/lib/current-user";
import { getCachedEffectivePermissionSet } from "@/lib/permissions/resolver";
import { FinanceTabs } from "@/components/finance/finance-tabs";
import { prisma } from "@/lib/prisma";
import { listRecurringInvoices } from "@/lib/recurring-invoices/recurring-invoices";
import { composeInvoiceNumberCandidate } from "@/lib/recurring-invoices/numbering";
import { formatDateOnlyForDisplay } from "@/lib/invoices/date-only";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { RecurringInvoiceFilterBar } from "@/components/recurring-invoices/recurring-invoice-filter-bar";
import { Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { RecordCardList, RecordCard, RecordCardField } from "@/components/ui/record-list";
import { formatStatusLabel } from "@/lib/format";
import type { RawSearchParams } from "@/lib/list-params";
import { parseRecurringInvoiceStatusFilter, parseRecurringInvoiceClientFilter } from "./view-params";

const PRIMARY_LINK_CLASSES =
  "inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2";

const SCHEDULE_LINK_CLASSES =
  "focus-visible:ring-focus-ring rounded hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

// User-authored values (schedule name up to 200 characters, client/project names, and an invoice
// prefix of up to 40 characters plus a sequence) may contain no break opportunity at all. Plain
// `break-words` does not lower a table cell's minimum width, so one long unbroken name stretched the
// table to ~2500px and pushed the remaining columns out of its scroller, unreachable by keyboard.
// `overflow-wrap: anywhere` lets the text wrap inside its column without altering or truncating it.
const WRAP_LONG_VALUE_CLASSES = "wrap-anywhere";

const FREQUENCY_LABELS: Record<string, string> = {
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  YEARLY: "Yearly",
};

/**
 * Recurring Invoices Phase 2A — the Staff list. OWNER/ADMIN-only, exactly
 * mirroring the Phase 1 domain layer's own gate: listRecurringInvoices()
 * itself returns FORBIDDEN for a MEMBER, which this page treats
 * identically to "not found" (notFound() elsewhere in this app never
 * distinguishes "exists but denied" from "doesn't exist" — this follows
 * the same discipline via a plain redirect-free 403-style render, matched
 * to how privileged-only pages elsewhere in this app already behave).
 */
export default async function RecurringInvoicesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { user, organizationId, membership } = await getCurrentMembership();
  const actor = { id: user.id, name: user.name, role: membership.role };
  const resolvedSearchParams = await searchParams;

  const status = parseRecurringInvoiceStatusFilter(resolvedSearchParams);
  const clientId = parseRecurringInvoiceClientFilter(resolvedSearchParams);

  const [listResult, clients, effectivePermissions] = await Promise.all([
    listRecurringInvoices(organizationId, actor, { status, clientId }),
    prisma.client.findMany({ where: { organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getCachedEffectivePermissionSet(organizationId, membership.role),
  ]);

  if (!listResult.ok) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <FinanceTabs recurringInvoicesManage={effectivePermissions.RECURRING_INVOICES_MANAGE} />
        <EmptyState title="Not available" description="You don't have permission to view recurring invoices." />
      </div>
    );
  }

  const schedules = listResult.recurringInvoices;
  const hasActiveFilters = Boolean(status || clientId);

  const clientIds = [...new Set(schedules.map((s) => s.clientId))];
  const projectIds = [...new Set(schedules.map((s) => s.projectId).filter((id): id is string => id !== null))];
  const [clientNames, projectNames, invoiceCounts] = await Promise.all([
    prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true } }),
    prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } }),
    prisma.invoice.groupBy({ by: ["recurringInvoiceId"], where: { recurringInvoiceId: { in: schedules.map((s) => s.id) } }, _count: { _all: true } }),
  ]);
  const clientNameById = new Map(clientNames.map((c) => [c.id, c.name]));
  const projectNameById = new Map(projectNames.map((p) => [p.id, p.name]));
  const invoiceCountById = new Map(invoiceCounts.map((row) => [row.recurringInvoiceId as string, row._count._all]));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <FinanceTabs recurringInvoicesManage={effectivePermissions.RECURRING_INVOICES_MANAGE} />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-text-primary text-2xl font-semibold tracking-tight">Recurring Invoices</h1>
          <p className="text-text-secondary mt-1 text-sm">Schedules that automatically generate draft invoices.</p>
        </div>
        {clients.length > 0 && (
          <Link href="/recurring-invoices/new" className={PRIMARY_LINK_CLASSES}>
            New schedule
          </Link>
        )}
      </div>

      {clients.length > 0 && (
        <RecurringInvoiceFilterBar status={status ?? ""} clientId={clientId ?? ""} clients={clients} hasActiveFilters={hasActiveFilters} />
      )}

      {clients.length === 0 ? (
        <EmptyState
          title="You need a client first"
          description="Recurring invoices must belong to a client. Add one before creating a schedule."
          action={
            <Link href="/clients/new" className={PRIMARY_LINK_CLASSES}>
              Add client
            </Link>
          }
        />
      ) : schedules.length === 0 ? (
        <EmptyState
          title={hasActiveFilters ? "No matching schedules" : "No recurring invoices yet"}
          description={
            hasActiveFilters
              ? "Try clearing filters to see more schedules."
              : "Create a schedule to automatically generate draft invoices on a recurring basis."
          }
          action={
            !hasActiveFilters ? (
              <Link href="/recurring-invoices/new" className={PRIMARY_LINK_CLASSES}>
                New schedule
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          {/*
            Below xl the eight-column table cannot fit (the sidebar takes 224px
            from md up, and columns that appeared by breakpoint were clipped
            inside the card's scroller at 320-430, 768-850 and 1024-1075px), so
            the shared stacked-card list is the one representation shown; the
            table appears from xl, where every column fits. Same pattern and
            cutover as the other staff lists (see record-list.tsx).
          */}
          <div className="hidden xl:block">
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell>Client</TableHeaderCell>
                  <TableHeaderCell>Project</TableHeaderCell>
                  <TableHeaderCell>Frequency</TableHeaderCell>
                  <TableHeaderCell>Next issue date</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Next invoice</TableHeaderCell>
                  <TableHeaderCell align="right">Generated</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {schedules.map((schedule) => (
                  <TableRow key={schedule.id}>
                    <TableCell emphasis className={WRAP_LONG_VALUE_CLASSES}>
                      <Link href={`/recurring-invoices/${schedule.id}`} className={SCHEDULE_LINK_CLASSES}>
                        {schedule.name ?? "Untitled schedule"}
                      </Link>
                    </TableCell>
                    <TableCell className={WRAP_LONG_VALUE_CLASSES}>{clientNameById.get(schedule.clientId) ?? "—"}</TableCell>
                    <TableCell className={WRAP_LONG_VALUE_CLASSES}>
                      {schedule.projectId ? (projectNameById.get(schedule.projectId) ?? "—") : "—"}
                    </TableCell>
                    <TableCell>{FREQUENCY_LABELS[schedule.frequency] ?? formatStatusLabel(schedule.frequency)}</TableCell>
                    <TableCell>{formatDateOnlyForDisplay(schedule.nextIssueDate)}</TableCell>
                    <TableCell>
                      <StatusBadge status={schedule.status} />
                    </TableCell>
                    <TableCell className={WRAP_LONG_VALUE_CLASSES}>
                      {composeInvoiceNumberCandidate(schedule.invoiceNumberPrefix, schedule.nextSequence)}
                    </TableCell>
                    <TableCell align="right">{invoiceCountById.get(schedule.id) ?? 0}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <RecordCardList>
            {schedules.map((schedule) => (
              <RecordCard key={schedule.id}>
                <RecordCardField
                  label="Name"
                  emphasis
                  value={
                    <Link href={`/recurring-invoices/${schedule.id}`} className={SCHEDULE_LINK_CLASSES}>
                      {schedule.name ?? "Untitled schedule"}
                    </Link>
                  }
                />
                <RecordCardField label="Client" value={clientNameById.get(schedule.clientId) ?? "—"} />
                <RecordCardField
                  label="Project"
                  value={schedule.projectId ? (projectNameById.get(schedule.projectId) ?? "—") : "—"}
                />
                <RecordCardField
                  label="Frequency"
                  value={FREQUENCY_LABELS[schedule.frequency] ?? formatStatusLabel(schedule.frequency)}
                />
                <RecordCardField label="Next issue date" value={formatDateOnlyForDisplay(schedule.nextIssueDate)} />
                <RecordCardField label="Status" value={<StatusBadge status={schedule.status} />} />
                <RecordCardField
                  label="Next invoice"
                  value={composeInvoiceNumberCandidate(schedule.invoiceNumberPrefix, schedule.nextSequence)}
                />
                <RecordCardField label="Generated" value={invoiceCountById.get(schedule.id) ?? 0} />
              </RecordCard>
            ))}
          </RecordCardList>
        </>
      )}
    </div>
  );
}
