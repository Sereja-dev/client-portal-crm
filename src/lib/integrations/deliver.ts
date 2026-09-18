import "server-only";
import { prisma } from "@/lib/prisma";
import { decryptCredential } from "./crypto";
import { validateSlackWebhookUrl } from "./slack-url";
import { sendSlackMessage, type SendSlackMessageFn } from "./slack-client";
import { buildSlackMessage } from "./message";
import { isIntegrationEventKey } from "./events";
import { CONNECTION_STATUS } from "./provider";
import { markConnectionError } from "./connection";
import type { IntegrationErrorCode } from "./error-codes";

/**
 * Integrations V1 (Slack Incoming Webhook only -- architecture lock
 * validation, locked spec §20/§21/§28). The one function that actually
 * attempts to send one IntegrationDelivery row to Slack — called both by
 * the synchronous post-commit best-effort first attempt (right after
 * enqueueIntegrationDelivery's own transaction commits) and by the
 * cron-triggered retry worker's per-row processing loop
 * (src/lib/integrations/jobs/retry-integration-deliveries.ts), after that
 * worker has already claimed the row (PROCESSING + lockedAt).
 *
 * `fromStatus` is the exact status the caller observed this row in right
 * before calling this function ("PENDING" for the fresh post-commit
 * path, "PROCESSING" for the worker's own claimed rows) — every
 * completion write below is a conditional `updateMany` matched on
 * `status: fromStatus`, so a concurrent Disconnect that already moved
 * this same row to CANCELED (locked spec §33) makes the completion write
 * match zero rows and silently no-op, rather than clobbering the
 * cancellation. This is the mechanism that closes the disconnect/
 * in-flight-delivery race as tightly as it can be closed without holding
 * a database transaction open across the HTTP call itself (an
 * unacceptable architecture this app already avoided once, in the
 * Industry Presets apply-transaction-latency fix).
 */

export const MAX_DELIVERY_ATTEMPTS = 3;
const RETRY_BACKOFF_MS: Record<number, number> = { 1: 15 * 60 * 1000, 2: 60 * 60 * 1000 };

/** Mirrors deliver-notification-email.ts's own computeNextAttemptAt exactly — same policy, same shape, applied to a different channel. */
export function computeNextIntegrationAttemptAt(now: Date, newAttempts: number): Date | null {
  if (newAttempts >= MAX_DELIVERY_ATTEMPTS) return null;
  const backoffMs = RETRY_BACKOFF_MS[newAttempts];
  if (backoffMs === undefined) return null;
  return new Date(now.getTime() + backoffMs);
}

export type DeliveryAttemptOutcome =
  | { outcome: "delivered" }
  | { outcome: "retry_scheduled"; errorCode: IntegrationErrorCode; nextAttemptAt: Date }
  | { outcome: "failed_terminal"; errorCode: IntegrationErrorCode }
  | { outcome: "skipped"; reason: "raced" | "connection_disconnected" | "tenant_mismatch" };

export async function attemptIntegrationDelivery(params: {
  deliveryId: string;
  fromStatus: "PENDING" | "PROCESSING";
  now: Date;
  deps?: { sendSlackMessage?: SendSlackMessageFn };
}): Promise<DeliveryAttemptOutcome> {
  const send = params.deps?.sendSlackMessage ?? sendSlackMessage;

  const delivery = await prisma.integrationDelivery.findUnique({
    where: { id: params.deliveryId },
    include: {
      integrationConnection: {
        select: { id: true, organizationId: true, status: true, encryptedCredential: true, credentialKeyVersion: true },
      },
      activity: { select: { id: true, organizationId: true, entityType: true, action: true, entityId: true, metadata: true } },
    },
  });
  if (!delivery) return { outcome: "skipped", reason: "raced" };

  const { integrationConnection: connection, activity } = delivery;

  // Locked spec §28 — re-verify tenant match on every dimension before
  // ever touching the network, never inferred from the deep-linked
  // entity alone.
  if (
    !activity ||
    activity.organizationId !== delivery.organizationId ||
    connection.organizationId !== delivery.organizationId
  ) {
    await failTerminal(delivery.id, params.fromStatus, "INTEGRATION_TENANT_MISMATCH");
    return { outcome: "skipped", reason: "tenant_mismatch" };
  }

  if (connection.status === CONNECTION_STATUS.DISCONNECTED || !connection.encryptedCredential || connection.credentialKeyVersion === null) {
    // Re-read immediately before send caught a disconnect (or a
    // never-connected/no-credential state) that raced ahead of this
    // worker's own claim — never sends, cancels defensively.
    await prisma.integrationDelivery.updateMany({
      where: { id: delivery.id, status: params.fromStatus },
      data: { status: "CANCELED", nextAttemptAt: null, lockedAt: null },
    });
    return { outcome: "skipped", reason: "connection_disconnected" };
  }

  if (!isIntegrationEventKey(delivery.eventKey)) {
    return failWithCode(delivery.id, params.fromStatus, params.now, delivery.attempts, "INTEGRATION_MESSAGE_BUILD_FAILED", false);
  }

  const text = buildSlackMessage({
    eventKey: delivery.eventKey,
    entityType: activity.entityType,
    entityId: activity.entityId,
    metadata: activity.metadata,
  });
  if (!text) {
    return failWithCode(delivery.id, params.fromStatus, params.now, delivery.attempts, "INTEGRATION_MESSAGE_BUILD_FAILED", false);
  }

  let webhookUrl: string;
  try {
    webhookUrl = decryptCredential(connection.encryptedCredential, connection.credentialKeyVersion, {
      organizationId: delivery.organizationId,
      provider: "SLACK_INCOMING_WEBHOOK",
    });
  } catch {
    return failWithCode(delivery.id, params.fromStatus, params.now, delivery.attempts, "SLACK_CREDENTIAL_DECRYPT_FAILED", false);
  }

  const revalidation = validateSlackWebhookUrl(webhookUrl);
  if (!revalidation.valid) {
    return failWithCode(delivery.id, params.fromStatus, params.now, delivery.attempts, "SLACK_CREDENTIAL_INVALID", false);
  }

  const result = await send(revalidation.canonicalUrl, text);

  // At-least-once, not exactly-once: if Slack already accepted this POST
  // but the completion write just below fails to commit (e.g. a DB
  // hiccup right after a successful send), this row stays eligible for
  // reclaim and a later retry will genuinely re-post the same message —
  // an accepted, narrow residual risk, the same one NotificationDelivery's
  // own email-delivery architecture already carries.
  if (result.outcome === "success") {
    const updated = await prisma.integrationDelivery.updateMany({
      where: { id: delivery.id, status: params.fromStatus },
      data: { status: "DELIVERED", deliveredAt: params.now, attempts: delivery.attempts + 1, nextAttemptAt: null, lockedAt: null },
    });
    if (updated.count === 0) return { outcome: "skipped", reason: "raced" };
    return { outcome: "delivered" };
  }

  return failWithCode(delivery.id, params.fromStatus, params.now, delivery.attempts, result.code, result.outcome === "retryable");
}

/**
 * The post-commit, request-bound entry point (locked spec §20) — called
 * once, immediately after enqueueIntegrationDelivery's own transaction
 * commits, for the delivery row it just created. Mirrors
 * deliverNotificationEmails' own "never throws back to the caller"
 * contract exactly: a Slack outage (or any unexpected error here) must
 * never fail the Lead/Client/Invoice/Contract mutation that triggered it
 * — every outcome resolves through attemptIntegrationDelivery's own
 * typed result instead of an exception escaping this function.
 */
export async function deliverIntegrationEventBestEffort(deliveryId: string): Promise<void> {
  try {
    await attemptIntegrationDelivery({ deliveryId, fromStatus: "PENDING", now: new Date() });
  } catch {
    // Swallowed deliberately — a delivery attempt that throws unexpectedly
    // (a DB hiccup, not a Slack HTTP failure — those are already typed
    // outcomes above) leaves the row PENDING, where the retry worker's own
    // claim query will pick it up on its next scheduled run.
  }
}

async function failWithCode(
  deliveryId: string,
  fromStatus: "PENDING" | "PROCESSING",
  now: Date,
  currentAttempts: number,
  errorCode: IntegrationErrorCode,
  retryable: boolean,
): Promise<DeliveryAttemptOutcome> {
  const newAttempts = currentAttempts + 1;
  const nextAttemptAt = retryable ? computeNextIntegrationAttemptAt(now, newAttempts) : null;

  const updated = await prisma.integrationDelivery.updateMany({
    where: { id: deliveryId, status: fromStatus },
    data: { status: "FAILED", attempts: newAttempts, nextAttemptAt, lastErrorCode: errorCode, lockedAt: null },
  });
  if (updated.count === 0) return { outcome: "skipped", reason: "raced" };

  if (nextAttemptAt) {
    return { outcome: "retry_scheduled", errorCode, nextAttemptAt };
  }

  // Terminal — either a permanent classification, or the retry ceiling
  // was just reached. Locked spec §10 reason (b): this is a legitimate
  // trigger to flip the connection to ERROR, system-triggered (no Staff
  // actor).
  const delivery = await prisma.integrationDelivery.findUnique({ where: { id: deliveryId }, select: { organizationId: true } });
  if (delivery) {
    await markConnectionError({
      organizationId: delivery.organizationId,
      actorId: null,
      actorName: "Aqenra",
      errorCode,
    });
  }
  return { outcome: "failed_terminal", errorCode };
}

/** Used only for the tenant-mismatch case above — a data-integrity anomaly, not a Slack failure, so it never touches connection status. */
async function failTerminal(
  deliveryId: string,
  fromStatus: "PENDING" | "PROCESSING",
  errorCode: IntegrationErrorCode,
): Promise<void> {
  await prisma.integrationDelivery.updateMany({
    where: { id: deliveryId, status: fromStatus },
    data: { status: "FAILED", attempts: { increment: 1 }, nextAttemptAt: null, lastErrorCode: errorCode, lockedAt: null },
  });
}
