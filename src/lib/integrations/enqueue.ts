import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { ActivityAction, ActivityEntityType } from "@/generated/prisma/enums";
import { matchIntegrationEvent, type ActivityLike } from "./events";
import { SLACK_PROVIDER } from "./provider";

/**
 * Integrations V1 (Slack Incoming Webhook only -- architecture lock
 * validation, locked spec §18/§19). Called at exactly the four real
 * mutation call sites (Lead create, Client create, Invoice issue,
 * Contract accept — staff and portal), inside the SAME transaction as
 * the business mutation's own createActivity() call, immediately after
 * it. Deliberately NOT wired into createActivity() itself (locked spec
 * §18's own explicit instruction) — createActivity() is called from
 * ~15+ unrelated domain modules, and this keeps every one of them
 * completely untouched.
 *
 * DB-only: no fetch, no network call of any kind — the actual Slack HTTP
 * attempt happens later, post-commit (src/lib/integrations/deliver.ts).
 * Never throws for an expected "nothing to do" outcome (no connection,
 * connection not CONNECTED, event already enqueued) — only a genuine,
 * unexpected DB error propagates, and that is intentional (locked spec
 * §19: "enqueue inside business transaction may only fail for real
 * DB/invariant/programming errors" — a real database failure legitimately
 * rolling back the business mutation with it is not a Slack-availability
 * concern).
 */
export async function enqueueIntegrationDelivery(
  tx: Prisma.TransactionClient,
  params: {
    organizationId: string;
    activity: { id: string; entityType: ActivityEntityType; action: ActivityAction; metadata: unknown };
  },
): Promise<{ deliveryId: string } | null> {
  const activityLike: ActivityLike = {
    entityType: params.activity.entityType,
    action: params.activity.action,
    metadata: params.activity.metadata,
  };
  const eventKey = matchIntegrationEvent(activityLike);
  if (!eventKey) return null;

  // Only a CONNECTED connection is eligible for a NEW enqueue (locked
  // spec §18: "if no CONNECTED connection: return cleanly without
  // write") — deliberately narrower than the delivery worker's own
  // retry-eligibility rule (which also processes ERROR-state
  // connections for a delivery already enqueued before the error). A
  // connection sitting in ERROR does not accumulate further work against
  // a known-broken destination until it's reconnected or a manual "Send
  // test" clears it back to CONNECTED.
  const connection = await tx.integrationConnection.findUnique({
    where: { organizationId_provider: { organizationId: params.organizationId, provider: SLACK_PROVIDER } },
    select: { id: true, status: true },
  });
  if (!connection || connection.status !== "CONNECTED") {
    return null;
  }

  // Check-then-create, deliberately NOT a try/catch around the create()
  // itself: unlike connection.ts's own P2002 handling (which wraps its
  // ENTIRE prisma.$transaction() call, i.e. catches OUTSIDE the
  // transaction boundary), this function runs INSIDE the caller's own
  // already-open business transaction — Postgres aborts a whole
  // transaction the instant any statement inside it violates a
  // constraint, so swallowing that error and continuing to use the same
  // `tx` afterwards leaves it permanently broken for the rest of the
  // transaction (see src/lib/recurring-invoices/generate.ts's own
  // identical "P2002 must be caught OUTSIDE $transaction(), never
  // inside" documented lesson). A plain existence check first is safe
  // here because a genuine concurrent double-insert for the exact same
  // (connection, activityId, eventKey) triple is not a realistic race:
  // `activityId` refers to an Activity row this exact same transaction
  // is the one and only creator of, and every real call site invokes
  // this function exactly once per that creation — the unique
  // constraint itself remains the real database-level guarantee against
  // duplicate rows; this check only needs to make a REPEATED call (e.g.
  // a retried Server Action re-running against an already-committed
  // Activity) a clean no-op, not a security-critical concurrency guard.
  const existing = await tx.integrationDelivery.findUnique({
    where: {
      integrationConnectionId_activityId_eventKey: {
        integrationConnectionId: connection.id,
        activityId: params.activity.id,
        eventKey,
      },
    },
    select: { id: true },
  });
  if (existing) return null;

  const delivery = await tx.integrationDelivery.create({
    data: {
      organizationId: params.organizationId,
      integrationConnectionId: connection.id,
      activityId: params.activity.id,
      eventKey,
      status: "PENDING",
    },
    select: { id: true },
  });
  return { deliveryId: delivery.id };
}
