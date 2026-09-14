import "server-only";
import { prisma } from "@/lib/prisma";
import type { ReportsPeriodRange } from "../period";
import type { ReportsPaidInvoiceRow } from "../calculations/revenue-trend";

/**
 * Reports Phase 1 — financial queries. Every function here takes an
 * already-resolved `organizationId` (server-resolved by the caller, never
 * accepted from a request param here) and an already-selected `currency`
 * (see currency.ts) — no function in this file ever aggregates `amount`
 * across more than one currency.
 */

const UNPAID_INVOICE_STATUSES = ["DRAFT", "SENT", "OVERDUE"] as const;

/**
 * Every PAID invoice row (amount, paidAt) for this organization/currency/
 * period — the single source both the "Paid revenue" KPI (via
 * summarizePaidRevenue below) and the revenue trend chart (via
 * calculations/revenue-trend.ts's own bucketReportsRevenue) are computed
 * from, matching dashboard/query.ts's own "select once, used for both the
 * KPI sum and the time series — never queried twice" discipline.
 *
 * Filters on `paidAt`, never `createdAt` — an invoice created inside the
 * period but paid later (or outside it) must not count; one paid outside
 * the period's creation window but inside its paidAt window must.
 */
export async function getPaidInvoiceRows(
  organizationId: string,
  currency: string,
  range: ReportsPeriodRange,
): Promise<ReportsPaidInvoiceRow[]> {
  const rows = await prisma.invoice.findMany({
    where: {
      organizationId,
      status: "PAID",
      currency,
      paidAt: { gte: range.start, lt: range.end },
    },
    select: { amount: true, paidAt: true },
  });
  // `paidAt` is nullable in the schema (Prisma can't narrow the selected
  // type from the WHERE filter above), but every row here matched
  // `paidAt: { gte, lt }`, so it is genuinely non-null — same cast
  // dashboard/query.ts's own identical paidInvoicesInPeriod mapping uses.
  return rows.map((row) => ({ amount: row.amount, paidAt: row.paidAt as Date }));
}

export function summarizePaidRevenue(rows: ReportsPaidInvoiceRow[]): { paidRevenue: number; paidInvoiceCount: number } {
  const paidRevenue = rows.reduce((sum, row) => sum + Number(row.amount), 0);
  return { paidRevenue, paidInvoiceCount: rows.length };
}

/**
 * Outstanding receivables: SUM(Invoice.amount) where status IN
 * (DRAFT, SENT, OVERDUE), currency = selected. Deliberately a CURRENT
 * SNAPSHOT — never date-range scoped (an outstanding invoice from six
 * months ago is still outstanding today; filtering it out of an
 * "Outstanding" figure because it falls outside the selected trend
 * period would misrepresent what's actually owed right now). Never
 * includes PAID (that's Paid revenue, a different number) or CANCELLED
 * (never owed).
 */
export async function getOutstandingNow(organizationId: string, currency: string): Promise<number> {
  const result = await prisma.invoice.aggregate({
    where: { organizationId, currency, status: { in: [...UNPAID_INVOICE_STATUSES] } },
    _sum: { amount: true },
  });
  return Number(result._sum.amount ?? 0);
}

export type ReportsTopClient = {
  clientId: string;
  clientName: string;
  paidAmount: number;
  paidInvoiceCount: number;
};

const TOP_CLIENTS_LIMIT = 5;

/**
 * Top 5 Clients by paid revenue within the selected organization/period/
 * currency. Two bounded queries, never N+1: an aggregate `groupBy` for
 * the ranking (by clientId, on Invoice — a plain scalar FK column, no
 * relation traversal needed for the aggregate itself), then one batched
 * `findMany` for the winning rows' display names. Deterministic tie-break
 * (`clientId` ascending after the amount) so two Clients tied on paid
 * amount always return in the same order.
 *
 * `Invoice.clientId` is required and `onDelete: Restrict` (see
 * prisma/schema.prisma's own Invoice model) — a Client can never be
 * deleted out from under an Invoice that references it, so every
 * `clientId` this groupBy returns is structurally guaranteed to resolve
 * in the follow-up findMany. The `nameById.has(...)` filter below is
 * still applied defensively rather than assumed, matching this app's own
 * "never trust silently, even where the schema already guarantees it"
 * discipline elsewhere (e.g. src/lib/import/job.ts's own doc comments).
 */
export async function getTopClientsByPaidRevenue(
  organizationId: string,
  currency: string,
  range: ReportsPeriodRange,
): Promise<ReportsTopClient[]> {
  const grouped = await prisma.invoice.groupBy({
    by: ["clientId"],
    where: { organizationId, status: "PAID", currency, paidAt: { gte: range.start, lt: range.end } },
    _sum: { amount: true },
    _count: true,
    orderBy: [{ _sum: { amount: "desc" } }, { clientId: "asc" }],
    take: TOP_CLIENTS_LIMIT,
  });

  if (grouped.length === 0) return [];

  const clientIds = grouped.map((g) => g.clientId);
  const clients = await prisma.client.findMany({
    where: { id: { in: clientIds }, organizationId },
    select: { id: true, name: true },
  });
  const nameById = new Map(clients.map((c) => [c.id, c.name]));

  return grouped
    .filter((g) => nameById.has(g.clientId))
    .map((g) => ({
      clientId: g.clientId,
      clientName: nameById.get(g.clientId)!,
      paidAmount: Number(g._sum.amount ?? 0),
      paidInvoiceCount: g._count,
    }));
}
