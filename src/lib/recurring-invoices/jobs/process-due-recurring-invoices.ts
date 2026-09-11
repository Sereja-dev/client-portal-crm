import "server-only";
import { prisma } from "@/lib/prisma";
import type { PrismaClientOrTx } from "../types";
import { listDueRecurringInvoices } from "../due-schedules";
import { generateRecurringInvoiceOccurrence, type GenerateRecurringInvoiceOccurrenceResult } from "../generate";
import { utcDateOnly } from "../date-math";
import { emptyRecurringInvoiceJobSummary, type RecurringInvoiceJobSummary } from "./types";

/**
 * The full generator-outcome -> summary-bucket mapping, exported as a pure
 * function for direct unit testing of every outcome (including the
 * near-impossible not_active/not_found/invalid_occurrence_date — state
 * could theoretically change between listDueRecurringInvoices' own read
 * and the actual generateRecurringInvoiceOccurrence call for that row —
 * which a real end-to-end integration test can't deterministically force
 * without an artificial race). "errored" is never produced here — that
 * bucket is reserved exclusively for a thrown exception, handled by the
 * caller's own try/catch, never by this mapping.
 */
export function mapGenerationOutcomeToSummaryBucket(
  outcome: GenerateRecurringInvoiceOccurrenceResult["outcome"],
): "generated" | "skipped" | "failed" {
  switch (outcome) {
    case "generated":
      return "generated";
    case "failed":
      return "failed";
    case "skipped_completed":
    case "skipped_claimed":
    case "not_active":
    case "not_found":
    case "invalid_occurrence_date":
      return "skipped";
  }
}

// A deliberately conservative starting bound, not a load-tested ceiling.
// Phase 1's own generation engine can incur RETRY_BACKOFF_MS=500 across up
// to MAX_ATTEMPTS=5 numbering-retry attempts per schedule (worst case
// ~3s/schedule against a real network-latency Postgres, not the local
// PGlite that backoff was tuned against) — an all-exhausted batch of 50
// would be ~150s, far over maxDuration=60. 15 keeps the all-exhausted
// worst case (~45s) comfortably under that ceiling with real margin; the
// realistic (low-exhaustion) case finishes in a few seconds. Raise this
// only with real Production evidence, never speculatively (same
// discipline reconcile-archive-objects.ts's own BATCH_SIZE=25 already
// established).
export const BATCH_SIZE = 15;

/**
 * Recurring Invoices Phase 2B-1 — the due-batch job. Never wired to any
 * cron schedule yet (vercel.json is untouched in this phase) — invoked
 * directly by tests and by the new, still-unscheduled cron route.
 *
 * Sequential, deliberately never parallelized: each generation attempt is
 * multiple real DB transactions, numbering retries may back off
 * (RETRY_BACKOFF_MS), and the whole batch runs under a bounded
 * maxDuration — running schedules concurrently would make the batch's own
 * total duration far less predictable for no real benefit (each
 * schedule's own generation is already fully self-contained and safe to
 * run one after another).
 *
 * Never claims/reclaims/writes to RecurringInvoiceOccurrence directly, and
 * never duplicates any part of the numbering/exhaustion state machine —
 * the unchanged Phase 1 generateRecurringInvoiceOccurrence() remains the
 * sole correctness/idempotency boundary. One schedule's failure (a
 * returned "failed" outcome, or a genuinely unexpected thrown exception)
 * never aborts the rest of the batch.
 */
export async function processDueRecurringInvoices(
  now: Date,
  limit: number,
  client: PrismaClientOrTx = prisma,
): Promise<RecurringInvoiceJobSummary> {
  const summary = emptyRecurringInvoiceJobSummary();

  const today = utcDateOnly(now);
  const dueSchedules = await listDueRecurringInvoices(today, limit, client);
  summary.scanned = dueSchedules.length;

  for (const schedule of dueSchedules) {
    try {
      // occurrenceDate is always this row's own nextIssueDate — never
      // `today` — a schedule due for a date days/weeks in the past during
      // backlog catch-up must generate for that actual date, not today's.
      const result = await generateRecurringInvoiceOccurrence(schedule.id, schedule.nextIssueDate, now, client);
      summary[mapGenerationOutcomeToSummaryBucket(result.outcome)] += 1;
    } catch {
      // Never leaks the raw exception (message, stack, or any DB detail)
      // into the aggregate summary — only the count changes. One
      // schedule's unexpected failure never aborts the remaining batch.
      summary.errored += 1;
    }
  }

  return summary;
}
