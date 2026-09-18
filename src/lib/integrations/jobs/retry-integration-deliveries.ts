import { prisma } from "@/lib/prisma";
import { attemptIntegrationDelivery, MAX_DELIVERY_ATTEMPTS, type DeliveryAttemptOutcome } from "../deliver";
import type { SendSlackMessageFn } from "../slack-client";

/**
 * Integrations V1 (Slack Incoming Webhook only -- architecture lock
 * validation, locked spec §22/§25). The cron-triggered retry fallback for
 * IntegrationDelivery rows the post-commit best-effort attempt didn't
 * resolve — directly mirrors
 * src/lib/notifications/jobs/retry-notification-deliveries.ts's own
 * proven two-phase claim mechanism (reclaim stale PROCESSING rows, then
 * claim fresh PENDING/FAILED-under-ceiling rows via a conditional
 * updateMany, then re-query by `lockedAt = now` to learn exactly what
 * THIS run claimed) verbatim, applied to a different outbox table.
 *
 * Concurrency reasoning is identical to that module's own doc comment:
 * Postgres evaluates each row's WHERE clause at the moment its own UPDATE
 * actually executes, so two overlapping runs racing for the same row
 * only ever let the one whose UPDATE commits first see the expected
 * starting status — the loser's WHERE no longer matches and it simply
 * skips that row. See this repo's own PGlite-concurrency-limitation note
 * (test/support/local-postgres.ts) for why this is proven by direct
 * reasoning about documented Postgres semantics, never by a genuine
 * multi-connection test in this sandbox.
 */

/** A PROCESSING row locked longer than this is presumed to belong to a worker that died mid-attempt — safe to reclaim. Same bound as NotificationDelivery's own STALE_LOCK_MS. */
export const STALE_LOCK_MS = 10 * 60 * 1000;

export type IntegrationDeliveryJobSummary = {
  scanned: number;
  claimed: number;
  delivered: number;
  retryScheduled: number;
  failedTerminal: number;
  skipped: number;
};

function emptySummary(): IntegrationDeliveryJobSummary {
  return { scanned: 0, claimed: 0, delivered: 0, retryScheduled: 0, failedTerminal: 0, skipped: 0 };
}

export async function retryIntegrationDeliveries(params: {
  now: Date;
  limit: number;
  deps?: { sendSlackMessage?: SendSlackMessageFn };
}): Promise<IntegrationDeliveryJobSummary> {
  const { now, limit } = params;
  const summary = emptySummary();
  const staleThreshold = new Date(now.getTime() - STALE_LOCK_MS);

  // 1. Reclaim stale PROCESSING rows first — a worker that claimed these
  // and never finished (crashed, timed out) left them stranded.
  const staleCandidates = await prisma.integrationDelivery.findMany({
    where: { status: "PROCESSING", lockedAt: { lt: staleThreshold } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true },
  });
  if (staleCandidates.length > 0) {
    await prisma.integrationDelivery.updateMany({
      where: { id: { in: staleCandidates.map((c) => c.id) }, status: "PROCESSING", lockedAt: { lt: staleThreshold } },
      data: { lockedAt: now },
    });
  }

  // 2. Claim fresh PENDING/FAILED rows due for retry, filling out the
  // rest of this run's batch limit.
  const remainingLimit = Math.max(limit - staleCandidates.length, 0);
  const freshCandidates =
    remainingLimit > 0
      ? await prisma.integrationDelivery.findMany({
          where: {
            OR: [
              { status: "PENDING" },
              {
                status: "FAILED",
                attempts: { lt: MAX_DELIVERY_ATTEMPTS },
                OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
              },
            ],
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: remainingLimit,
          select: { id: true },
        })
      : [];
  if (freshCandidates.length > 0) {
    await prisma.integrationDelivery.updateMany({
      where: { id: { in: freshCandidates.map((c) => c.id) }, status: { in: ["PENDING", "FAILED"] } },
      data: { status: "PROCESSING", lockedAt: now },
    });
  }

  summary.scanned = staleCandidates.length + freshCandidates.length;

  const allCandidateIds = [...staleCandidates, ...freshCandidates].map((c) => c.id);
  if (allCandidateIds.length === 0) return summary;

  // The definitive "what did THIS run actually claim" read — `lockedAt =
  // now` is an exact match (not a range), unique per invocation, mirroring
  // retry-notification-deliveries.ts's own identical technique.
  const claimed = await prisma.integrationDelivery.findMany({
    where: { id: { in: allCandidateIds }, status: "PROCESSING", lockedAt: now },
    select: { id: true },
  });
  summary.claimed = claimed.length;

  for (const row of claimed) {
    let outcome: DeliveryAttemptOutcome;
    try {
      outcome = await attemptIntegrationDelivery({
        deliveryId: row.id,
        fromStatus: "PROCESSING",
        now,
        deps: params.deps,
      });
    } catch {
      // One claimed row's own processing failed unexpectedly (a DB
      // hiccup, not a Slack HTTP failure — those are already typed
      // outcomes) — it stays PROCESSING and gets reclaimed as stale on a
      // later run; every other claimed row in this batch still proceeds.
      continue;
    }

    if (outcome.outcome === "delivered") summary.delivered += 1;
    else if (outcome.outcome === "retry_scheduled") summary.retryScheduled += 1;
    else if (outcome.outcome === "failed_terminal") summary.failedTerminal += 1;
    else summary.skipped += 1;
  }

  return summary;
}
