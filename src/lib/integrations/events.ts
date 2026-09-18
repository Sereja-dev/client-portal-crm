import type { ActivityAction, ActivityEntityType } from "@/generated/prisma/enums";

/**
 * Integrations V1 (Slack Incoming Webhook only -- architecture lock
 * validation, locked spec §17). The one, fixed, code-defined catalog of
 * which Activity events notify Slack -- no per-organization/per-event
 * toggle table exists in V1 (locked spec §12: "no
 * IntegrationEventSubscription table"), so this list alone is the entire
 * configuration surface. Every key here was verified against a real,
 * currently-shipping `createActivity()` call site before being added --
 * see this module's own EVENT_DEFINITIONS entries for exactly which file
 * each one comes from.
 */

export const EVENT_KEYS = ["LEAD_CREATED", "CLIENT_CREATED", "INVOICE_SENT", "CONTRACT_ACCEPTED"] as const;
export type IntegrationEventKey = (typeof EVENT_KEYS)[number];

export function isIntegrationEventKey(value: string): value is IntegrationEventKey {
  return (EVENT_KEYS as readonly string[]).includes(value);
}

export type ActivityLike = {
  entityType: ActivityEntityType;
  action: ActivityAction;
  metadata: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type EventDefinition = {
  key: IntegrationEventKey;
  /** Whether a given Activity row is an instance of this event — the sole allowlist decision point (locked spec §17/§18). */
  matches: (activity: ActivityLike) => boolean;
};

const EVENT_DEFINITIONS: readonly EventDefinition[] = [
  {
    // src/lib/leads/create-core.ts — interactive Lead creation only (CSV
    // import deliberately writes no Activity row at all, so it can never
    // match here either — see that module's own doc comment).
    key: "LEAD_CREATED",
    matches: (activity) => activity.entityType === "LEAD" && activity.action === "CREATED",
  },
  {
    // src/lib/clients/create-core.ts — interactive Client creation only,
    // same "import writes no Activity" exclusion as LEAD_CREATED above.
    key: "CLIENT_CREATED",
    matches: (activity) => activity.entityType === "CLIENT" && activity.action === "CREATED",
  },
  {
    // src/lib/invoices/pdf/issue-invoice.ts — the DRAFT -> SENT
    // transition specifically, not every INVOICE/STATUS_CHANGED event
    // (e.g. SENT -> PAID, SENT -> OVERDUE do not match this event key).
    key: "INVOICE_SENT",
    matches: (activity) =>
      activity.entityType === "INVOICE" &&
      activity.action === "STATUS_CHANGED" &&
      isRecord(activity.metadata) &&
      activity.metadata.to === "SENT",
  },
  {
    // src/lib/contracts/service.ts — the SENT -> ACCEPTED transition
    // specifically, matched regardless of whether the acceptance was
    // staff- or portal-originated (acceptContractByStaff /
    // acceptContractByPortal both write the identical
    // {entityType: CONTRACT, action: STATUS_CHANGED, metadata.to:
    // "ACCEPTED"} shape — this catalog matches on that shape alone, the
    // same way it does not distinguish LEAD_CREATED by actor either).
    key: "CONTRACT_ACCEPTED",
    matches: (activity) =>
      activity.entityType === "CONTRACT" &&
      activity.action === "STATUS_CHANGED" &&
      isRecord(activity.metadata) &&
      activity.metadata.to === "ACCEPTED",
  },
];

/** Returns the single matching event key for this Activity, or null if it isn't one of the fixed V1 events — the sole gate enqueueIntegrationDelivery consults (src/lib/integrations/enqueue.ts). Definitions are structurally exclusive (distinct entityType per key), so at most one can ever match. */
export function matchIntegrationEvent(activity: ActivityLike): IntegrationEventKey | null {
  for (const definition of EVENT_DEFINITIONS) {
    if (definition.matches(activity)) return definition.key;
  }
  return null;
}
