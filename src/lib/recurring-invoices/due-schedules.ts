import "server-only";
import { prisma } from "@/lib/prisma";
import type { PrismaClientOrTx } from "./types";

/**
 * Recurring Invoices Phase 2B-1 — the due-batch job's own candidate query.
 * Deliberately a plain, lock-free read: the occurrence ledger inside
 * generateRecurringInvoiceOccurrence() is the sole exclusivity/idempotency
 * boundary (see the finalized Phase 2B design). This function never
 * excludes a schedule that's already mid-processing by an overlapping
 * invocation — that case is handled harmlessly downstream via
 * skipped_claimed, exactly the same way Phase 2A's own manual generation
 * action already relies on it.
 *
 * Selects only `id`/`nextIssueDate` — never template/line-item data, which
 * generateRecurringInvoiceOccurrence's own loadScheduleForGeneration()
 * re-fetches fresh anyway. `nextIssueDate` is selected (not just `id`)
 * because it's the actual occurrenceDate to pass to the generator — it
 * can be days or weeks in the past during backlog catch-up, never
 * assumed to be "today."
 */
export type DueRecurringInvoice = { id: string; nextIssueDate: Date };

export async function listDueRecurringInvoices(
  today: Date,
  limit: number,
  client: PrismaClientOrTx = prisma,
): Promise<DueRecurringInvoice[]> {
  return client.recurringInvoice.findMany({
    where: { status: "ACTIVE", nextIssueDate: { lte: today } },
    select: { id: true, nextIssueDate: true },
    orderBy: [{ nextIssueDate: "asc" }, { id: "asc" }],
    take: limit,
  });
}
