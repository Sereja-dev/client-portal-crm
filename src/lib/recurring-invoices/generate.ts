import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { PrismaClientOrTx } from "./types";
import { computeNextIssueDate } from "./date-math";
import { composeInvoiceNumberCandidate } from "./numbering";
import { calculateInvoiceTotals } from "@/lib/invoices/calculations";
import { mapInvoiceWriteError } from "@/lib/invoices/write-conflict-mapper";
import { createActivity } from "@/lib/activity/create-activity";
import { buildInvoiceSnapshotMetadata } from "@/lib/activity/invoice-metadata";

/**
 * Recurring Invoices Phase 1 — the idempotent generation engine. Implements
 * the finalized claim/reclaim + numbering + exhaustion state machine
 * (readiness assessment plus its three subsequent correctness
 * corrections, this repo's own PR history) exactly, with no shortcuts.
 * Never wired to any cron route in this phase — invoked directly by
 * tests, and by a future Phase 2 cron loop unchanged.
 *
 * A generated Invoice is an ordinary DRAFT Invoice from the instant it's
 * created: no PDF, no email, no Portal publication, no finalized snapshot
 * — those only ever happen later, if a staff member uses the existing
 * Issue flow on it directly. This module never touches any of that
 * machinery.
 */

// A 10-minute lease, consistent with this app's existing stale-lock
// precedent (retryNotificationDeliveries' own STALE_LOCK_MS,
// reconcileInvoicePdfArchiveObjects' own CLEANUP_LEASE_MS) — kept the
// same even though Phase 1 generation is DB-only (no PDF/email network
// calls), for consistency with that established constant rather than a
// speculative tighter value.
export const CLAIM_LEASE_MS = 10 * 60 * 1000;

// Bounded total attempts per generation call — shared across both a
// numbering P2002 retry and a sequence guard-miss restart (see the
// finalized numbering-exhaustion design's own rationale).
export const MAX_ATTEMPTS = 5;

// A small backoff between numbering-retry attempts within the same claim
// (applied after any attempt whose transaction actually rolled back —
// never before the first attempt). Defensible on its own as an ordinary
// retry-loop courtesy against a real Postgres connection; also confirmed
// during test authoring to be necessary against this repo's own
// PGlite-backed integration test database specifically (a rapid,
// back-to-back sequence of failed/rolled-back transactions on that engine
// was observed to leave transient, incorrect state on the very next
// query otherwise — see attemptGeneration's own comment on why the P2002
// is never caught inside the transaction). Bounded at worst case
// MAX_ATTEMPTS * this value — negligible for a background job with no
// user-facing latency requirement.
export const RETRY_BACKOFF_MS = 500;

export type GenerateRecurringInvoiceOccurrenceResult =
  | { outcome: "generated"; invoiceId: string }
  | { outcome: "skipped_completed" }
  | { outcome: "skipped_claimed" }
  | { outcome: "failed"; reason: string }
  | { outcome: "not_active" }
  | { outcome: "not_found" }
  | { outcome: "invalid_occurrence_date" };

function isUniqueConstraintViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * Phase 2A addition (Staff UI manual generation button) — purely additive,
 * no existing behavior changed. Exported so the Staff UI's own "is this
 * schedule due today" eligibility check (both the server-rendered
 * button's visibility and the manual Server Action's own pre-check) reuses
 * the exact same UTC-midnight comparison isValidOccurrenceDate() already
 * uses internally, rather than a second, independently-maintained copy of
 * this date math living in the UI layer. Pure, no I/O.
 */
export function isRecurringInvoiceDueToday(nextIssueDate: Date, now: Date): boolean {
  const todayUtcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return nextIssueDate.getTime() <= todayUtcMidnight.getTime();
}

/**
 * occurrenceDate must be a genuine date-only value (UTC midnight, same
 * persisted convention as every other date-only column in this app) and
 * may never name a calendar date after `now`'s own — an occurrence is
 * never generated ahead of its own due date. Deliberately does NOT
 * require occurrenceDate to equal the schedule's CURRENT nextIssueDate —
 * the occurrence ledger's own unique(recurringInvoiceId, occurrenceDate)
 * is what makes any specific calendar occurrence safe to (re)claim on its
 * own terms, independent of wherever nextIssueDate has since moved to.
 */
function isValidOccurrenceDate(occurrenceDate: Date, now: Date): boolean {
  if (
    occurrenceDate.getUTCHours() !== 0 ||
    occurrenceDate.getUTCMinutes() !== 0 ||
    occurrenceDate.getUTCSeconds() !== 0 ||
    occurrenceDate.getUTCMilliseconds() !== 0
  ) {
    return false;
  }
  return isRecurringInvoiceDueToday(occurrenceDate, now);
}

// ---------------------------------------------------------------------------
// Transaction A — claim/reclaim. Each branch is a single conditional
// statement whose affected-row-count is the sole winner signal — never a
// read-then-trust decision (see the finalized concurrency design's own
// "claim token ownership" section).
// ---------------------------------------------------------------------------

export type ClaimResult =
  | { outcome: "claimed"; occurrenceId: string; claimToken: string }
  | { outcome: "skipped_completed" }
  | { outcome: "skipped_claimed" };

/**
 * Exported for direct testing of the claim/reclaim state machine itself
 * (items 31/34/35/36) — generateRecurringInvoiceOccurrence remains the
 * only entry point real callers (tests aside) should ever use; this
 * export exists purely so the claim mechanism can be exercised and
 * asserted on independently of a full generation attempt, the same
 * "export the small testable unit even though the real call site is a
 * larger orchestrating function" precedent this session already
 * established (e.g. combineDurationInput, isTaskValidForProject).
 */
export async function claimOccurrence(
  client: PrismaClientOrTx,
  recurringInvoiceId: string,
  occurrenceDate: Date,
  now: Date,
): Promise<ClaimResult> {
  const claimToken = randomUUID();
  const staleThreshold = new Date(now.getTime() - CLAIM_LEASE_MS);

  // Cases 4 & 5 (stale PENDING / FAILED) — one conditional UPDATE covers
  // both reclaim conditions.
  const reclaimed = await client.recurringInvoiceOccurrence.updateMany({
    where: {
      recurringInvoiceId,
      occurrenceDate,
      OR: [{ status: "FAILED" }, { status: "PENDING", claimedAt: { lt: staleThreshold } }],
    },
    data: { status: "PENDING", claimedAt: now, claimToken, attemptCount: { increment: 1 } },
  });

  if (reclaimed.count === 1) {
    const row = await client.recurringInvoiceOccurrence.findUniqueOrThrow({
      where: { recurringInvoiceId_occurrenceDate: { recurringInvoiceId, occurrenceDate } },
      select: { id: true },
    });
    return { outcome: "claimed", occurrenceId: row.id, claimToken };
  }

  // Not reclaimable — either COMPLETED, or a fresh PENDING another worker
  // owns (Cases 2 & 3), or no row exists yet (Case 1).
  const existing = await client.recurringInvoiceOccurrence.findUnique({
    where: { recurringInvoiceId_occurrenceDate: { recurringInvoiceId, occurrenceDate } },
    select: { status: true },
  });
  if (existing) {
    return existing.status === "COMPLETED" ? { outcome: "skipped_completed" } : { outcome: "skipped_claimed" };
  }

  // Case 1 — no occurrence row. A concurrent unique-constraint loser does
  // NOT generate: it simply re-reads whatever the winner left behind.
  try {
    const created = await client.recurringInvoiceOccurrence.create({
      data: { recurringInvoiceId, occurrenceDate, status: "PENDING", claimedAt: now, claimToken, attemptCount: 1 },
      select: { id: true },
    });
    return { outcome: "claimed", occurrenceId: created.id, claimToken };
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      const raced = await client.recurringInvoiceOccurrence.findUnique({
        where: { recurringInvoiceId_occurrenceDate: { recurringInvoiceId, occurrenceDate } },
        select: { status: true },
      });
      return raced?.status === "COMPLETED" ? { outcome: "skipped_completed" } : { outcome: "skipped_claimed" };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Transaction B — one full transaction per numbering candidate. Write
// order exactly matches the finalized design: (1) reverify+refresh claim
// ownership, (2) conditionally bump nextSequence, (3) create the DRAFT
// Invoice, (4) complete the occurrence, (5) forward-only advance
// nextIssueDate.
// ---------------------------------------------------------------------------

type ScheduleForGeneration = {
  id: string;
  organizationId: string;
  status: "ACTIVE" | "PAUSED" | "ARCHIVED";
  clientId: string;
  projectId: string | null;
  frequency: "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";
  anchorDay: number;
  invoiceNumberPrefix: string;
  dueDateOffsetDays: number | null;
  currency: string;
  discountType: "NONE" | "PERCENTAGE" | "FIXED";
  discountValue: Prisma.Decimal | null;
  taxRatePercent: Prisma.Decimal | null;
  taxLabel: "TAX" | "VAT" | "GST";
  notes: string | null;
  internalNotes: string | null;
  lineItems: { description: string; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal }[];
  projectName: string | null;
};

type AttemptOutcome =
  | { outcome: "generated"; invoiceId: string }
  | { outcome: "ownership_lost" }
  | { outcome: "number_conflict" }
  | { outcome: "sequence_guard_miss" };

async function attemptGeneration(
  tx: PrismaClientOrTx,
  params: {
    schedule: ScheduleForGeneration;
    occurrenceId: string;
    occurrenceDate: Date;
    claimToken: string;
    roundBaseSequence: number;
    candidateSequence: number;
    now: Date;
  },
): Promise<AttemptOutcome> {
  const { schedule, occurrenceId, occurrenceDate, claimToken, roundBaseSequence, candidateSequence, now } = params;

  // 1. Reverify + refresh claim ownership.
  const reverify = await tx.recurringInvoiceOccurrence.updateMany({
    where: { id: occurrenceId, status: "PENDING", claimToken },
    data: { claimedAt: now },
  });
  if (reverify.count !== 1) {
    return { outcome: "ownership_lost" };
  }

  // 2. Conditionally bump nextSequence — the forward-only guard against
  // a concurrent occurrence of the SAME schedule (e.g. backlog catch-up)
  // already having moved it.
  const seqBump = await tx.recurringInvoice.updateMany({
    where: { id: schedule.id, nextSequence: roundBaseSequence },
    data: { nextSequence: candidateSequence + 1 },
  });
  if (seqBump.count !== 1) {
    return { outcome: "sequence_guard_miss" };
  }

  // 3. Create the DRAFT Invoice using the exact same total-calculation
  // utility ordinary Invoice creation uses — never a stale precomputed
  // total.
  const calc = calculateInvoiceTotals({
    subtotalSource: {
      mode: "lineItems",
      lineItems: schedule.lineItems.map((li) => ({ description: li.description, quantity: li.quantity, unitPrice: li.unitPrice })),
    },
    discount: schedule.discountType === "NONE" ? { type: "NONE" } : { type: schedule.discountType, value: schedule.discountValue ?? "0" },
    taxRatePercent: schedule.taxRatePercent,
  });
  if (!calc.ok) {
    // Structurally unreachable — the template was already validated by
    // parseRecurringInvoiceTemplateFields at create/update time via this
    // exact same function. Treated as a hard failure (never silently
    // "succeeds" with wrong totals) rather than papered over.
    throw new Error(`recurring invoice template failed recalculation at generation time: ${calc.error.code}`);
  }

  const invoiceNumber = composeInvoiceNumberCandidate(schedule.invoiceNumberPrefix, candidateSequence);
  const dueDate = schedule.dueDateOffsetDays === null ? null : new Date(occurrenceDate.getTime() + schedule.dueDateOffsetDays * 24 * 60 * 60 * 1000);

  // Deliberately NOT try/caught here — a P2002 on Invoice.create() must
  // propagate all the way out of the enclosing prisma.$transaction() call
  // uncaught, exactly matching this codebase's own established discipline
  // (createInvoiceAction catches P2002 OUTSIDE its whole $transaction()
  // call, never inside). Catching it here and returning a normal value
  // instead would make Prisma treat the callback as having resolved
  // successfully and attempt to COMMIT a transaction Postgres already
  // aborted server-side — confirmed during test authoring, against this
  // repo's own PGlite-backed integration test database, to leave the
  // connection/transaction state unreliable for whatever query runs next
  // (see RETRY_BACKOFF_MS's own comment for the mitigation this motivated
  // in the retry loop below). The caller (generateRecurringInvoiceOccurrence's
  // own while loop) catches the propagated error and classifies it via
  // mapInvoiceWriteError, exactly like every other Invoice writer in this
  // app already does.
  const invoice = await tx.invoice.create({
    data: {
      invoiceNumber,
      status: "DRAFT",
      amount: calc.total,
      subtotal: calc.subtotal,
      discountAmount: calc.discountAmount,
      taxAmount: calc.taxAmount,
      discountType: schedule.discountType,
      discountValue: schedule.discountType === "NONE" ? null : schedule.discountValue,
      taxRatePercent: schedule.taxRatePercent,
      taxLabel: schedule.taxLabel,
      currency: schedule.currency,
      issueDate: occurrenceDate,
      dueDate,
      notes: schedule.notes,
      internalNotes: schedule.internalNotes,
      clientId: schedule.clientId,
      projectId: schedule.projectId,
      organizationId: schedule.organizationId,
      recurringInvoiceId: schedule.id,
      lineItems: {
        create: calc.lineItems.map((li, index) => ({
          description: li.description,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          lineTotal: li.lineTotal,
          position: index,
        })),
      },
    },
  });

  // 4. Complete the occurrence — same claimToken predicate as step 1,
  // defense in depth.
  const complete = await tx.recurringInvoiceOccurrence.updateMany({
    where: { id: occurrenceId, status: "PENDING", claimToken },
    data: { status: "COMPLETED", invoiceId: invoice.id, failureReason: null },
  });
  if (complete.count !== 1) {
    // Unreachable given step 1 already proved+locked ownership within
    // this same transaction — thrown as a hard failure (forces a
    // rollback) rather than silently leaving an uncompleted ledger row
    // next to a real Invoice.
    throw new Error("recurring invoice occurrence completion guard failed unexpectedly");
  }

  // 5. Forward-only advance nextIssueDate — only if this occurrence is
  // still the schedule's current forward pointer. A guard miss here just
  // means a later, correctly-ordered completion will advance it instead;
  // never regressed, never thrown on.
  const nextIssueDate = computeNextIssueDate(occurrenceDate, schedule.frequency, schedule.anchorDay);
  await tx.recurringInvoice.updateMany({
    where: { id: schedule.id, nextIssueDate: occurrenceDate },
    data: { nextIssueDate },
  });

  // The generated Invoice gets its normal INVOICE/CREATED Activity, same
  // as any manually-created Invoice — actorId null + "Recurring schedule"
  // in metadata, the same no-human-actor convention Portal-originated
  // Activity already established (src/app/portal/(app)/quotes/actions.ts).
  await createActivity(tx, {
    organizationId: schedule.organizationId,
    actorId: null,
    entityType: "INVOICE",
    entityId: invoice.id,
    action: "CREATED",
    metadata: buildInvoiceSnapshotMetadata(invoice, calc.lineItems.length, schedule.projectName, "Recurring schedule"),
  });

  return { outcome: "generated", invoiceId: invoice.id };
}

// ---------------------------------------------------------------------------
// Transaction C — numbering exhaustion. Marks the occurrence FAILED and,
// best-effort, advances nextSequence past every candidate this round
// conclusively proved taken — the fix for the infinite-FAILED-retry gap
// identified in the third correctness correction.
// ---------------------------------------------------------------------------

async function markExhausted(
  tx: PrismaClientOrTx,
  params: { occurrenceId: string; claimToken: string; recurringInvoiceId: string; roundBaseSequence: number; exhaustedCandidateCount: number },
): Promise<{ outcome: "failed" } | { outcome: "ownership_lost" }> {
  const { occurrenceId, claimToken, recurringInvoiceId, roundBaseSequence, exhaustedCandidateCount } = params;

  const failed = await tx.recurringInvoiceOccurrence.updateMany({
    where: { id: occurrenceId, status: "PENDING", claimToken },
    data: { status: "FAILED", failureReason: "NUMBERING_EXHAUSTED" },
  });
  if (failed.count !== 1) {
    return { outcome: "ownership_lost" };
  }

  // Best-effort — a guard miss (count 0) means another worker already
  // moved nextSequence; skipped silently, never thrown on, never retried.
  await tx.recurringInvoice.updateMany({
    where: { id: recurringInvoiceId, nextSequence: roundBaseSequence },
    data: { nextSequence: roundBaseSequence + exhaustedCandidateCount },
  });

  return { outcome: "failed" };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

async function loadScheduleForGeneration(
  client: PrismaClientOrTx,
  recurringInvoiceId: string,
): Promise<ScheduleForGeneration | null> {
  const row = await client.recurringInvoice.findUnique({
    where: { id: recurringInvoiceId },
    include: { lineItems: { orderBy: { position: "asc" } }, project: { select: { name: true } } },
  });
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organizationId,
    status: row.status,
    clientId: row.clientId,
    projectId: row.projectId,
    frequency: row.frequency,
    anchorDay: row.anchorDay,
    invoiceNumberPrefix: row.invoiceNumberPrefix,
    dueDateOffsetDays: row.dueDateOffsetDays,
    currency: row.currency,
    discountType: row.discountType,
    discountValue: row.discountValue,
    taxRatePercent: row.taxRatePercent,
    taxLabel: row.taxLabel,
    notes: row.notes,
    internalNotes: row.internalNotes,
    lineItems: row.lineItems.map((li) => ({ description: li.description, quantity: li.quantity, unitPrice: li.unitPrice })),
    projectName: row.project?.name ?? null,
  } satisfies ScheduleForGeneration;
}

/**
 * Attempts to generate the Invoice for exactly one (recurringInvoiceId,
 * occurrenceDate) occurrence. Org-safe by construction: the schedule's own
 * organizationId (never a caller-supplied one) is what every subsequent
 * write is scoped to. Never throws for an expected outcome — every
 * expected case returns a structured result; only a genuinely unexpected
 * DB/driver error propagates (and rolls back whatever transaction it
 * occurred in, per Prisma/Postgres's own default behavior).
 */
export async function generateRecurringInvoiceOccurrence(
  recurringInvoiceId: string,
  occurrenceDate: Date,
  now: Date,
  client: PrismaClientOrTx = prisma,
): Promise<GenerateRecurringInvoiceOccurrenceResult> {
  const schedule = await loadScheduleForGeneration(client, recurringInvoiceId);
  if (!schedule) {
    return { outcome: "not_found" };
  }
  if (schedule.status !== "ACTIVE") {
    return { outcome: "not_active" };
  }

  if (!isValidOccurrenceDate(occurrenceDate, now)) {
    return { outcome: "invalid_occurrence_date" };
  }

  const claim = await claimOccurrence(client, recurringInvoiceId, occurrenceDate, now);
  if (claim.outcome !== "claimed") {
    return claim;
  }

  let roundBaseSequence = (await client.recurringInvoice.findUniqueOrThrow({ where: { id: recurringInvoiceId }, select: { nextSequence: true } }))
    .nextSequence;
  let offset = 0;
  let totalAttempts = 0;
  let exhaustedThisRound = 0;

  while (totalAttempts < MAX_ATTEMPTS) {
    totalAttempts++;
    const candidateSequence = roundBaseSequence + offset;

    // A small backoff before each attempt after the first — cheap
    // insurance against hammering the DB with back-to-back transactions
    // in a tight retry loop (a normal, common retry-loop courtesy), and
    // gives a just-failed transaction's rollback time to fully settle
    // before the next one starts.
    if (totalAttempts > 1) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS));
    }

    const attemptParams = { schedule, occurrenceId: claim.occurrenceId, occurrenceDate, claimToken: claim.claimToken, roundBaseSequence, candidateSequence, now };
    let result: AttemptOutcome;
    try {
      result =
        client === prisma
          ? await prisma.$transaction((tx) => attemptGeneration(tx, attemptParams))
          : await attemptGeneration(client, attemptParams);
    } catch (err) {
      // The only expected propagated error is Invoice.create()'s own
      // organizationId+invoiceNumber P2002 (see attemptGeneration's own
      // header comment on why it's never caught internally). Anything
      // else is a genuinely unexpected failure and is rethrown, never
      // silently swallowed as a numbering conflict.
      if (mapInvoiceWriteError(err) !== "INVOICE_NUMBER_CONFLICT") {
        throw err;
      }
      result = { outcome: "number_conflict" };
    }

    if (result.outcome === "generated") {
      return { outcome: "generated", invoiceId: result.invoiceId };
    }
    if (result.outcome === "ownership_lost") {
      return { outcome: "skipped_claimed" };
    }
    if (result.outcome === "sequence_guard_miss") {
      const fresh = await client.recurringInvoice.findUniqueOrThrow({ where: { id: recurringInvoiceId }, select: { nextSequence: true } });
      roundBaseSequence = fresh.nextSequence;
      offset = 0;
      exhaustedThisRound = 0;
      continue;
    }
    // number_conflict
    offset++;
    exhaustedThisRound++;
  }

  // Same backoff rationale as each retry attempt above — this transaction
  // directly follows the last (rolled-back) attempt.
  await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS));

  const exhaustParams = { occurrenceId: claim.occurrenceId, claimToken: claim.claimToken, recurringInvoiceId, roundBaseSequence, exhaustedCandidateCount: exhaustedThisRound };
  const failResult = client === prisma ? await prisma.$transaction((tx) => markExhausted(tx, exhaustParams)) : await markExhausted(client, exhaustParams);

  if (failResult.outcome === "ownership_lost") {
    return { outcome: "skipped_claimed" };
  }
  return { outcome: "failed", reason: "NUMBERING_EXHAUSTED" };
}
