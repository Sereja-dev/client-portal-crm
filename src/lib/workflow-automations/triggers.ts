import "server-only";
import type { ActivityAction, ActivityEntityType } from "@/generated/prisma/enums";

/**
 * Workflow Automations Phase 1 — the strict V1 trigger allowlist.
 *
 * This is a *policy* allowlist, not a type-level one (see
 * WorkflowAutomation's own schema doc comment): the database happily
 * stores any (ActivityEntityType, ActivityAction) pair, but only the
 * pairs defined in TRIGGER_DEFINITIONS below are ever accepted by
 * parseWorkflowAutomationTrigger. Workflow Automations V1 is
 * Staff-originated only (see the module header of automations.ts) — every
 * entry below was individually verified, by reading the actual current
 * mutation source, to be emitted *exclusively* by a Staff-authenticated
 * Server Action or domain function, never by a Portal, public, or
 * cron/system code path that happens to share the same entityType+action
 * pair. `activity.actorId !== null` is deliberately never used as that
 * discriminator (see automations.ts's own header comment for why) —
 * these four pairs are safe because no other caller anywhere in the
 * codebase writes this exact (entityType, action) combination at all, not
 * because of anything actorId happens to hold.
 *
 * Verified against the repository at HEAD 73787efd44ec888faa58af1b8e3be0abcc676ca1:
 *
 *   LEAD.STATUS_CHANGED           — only src/app/(dashboard)/leads/actions.ts
 *                                    (Staff Server Actions). No Portal or
 *                                    public Lead mutation path exists.
 *   INVOICE.STATUS_CHANGED        — only src/app/(dashboard)/invoices/[id]/
 *                                    status-actions.ts and src/lib/invoices/
 *                                    pdf/issue-invoice.ts (both Staff-only;
 *                                    issue-invoice.ts's own DRAFT->SENT
 *                                    transition is triggered by a Staff
 *                                    Server Action). No Portal invoice
 *                                    mutation exists; the billing webhook
 *                                    route never writes an INVOICE Activity.
 *   CLIENT_REQUEST.STATUS_CHANGED — only src/lib/client-requests/staff.ts.
 *                                    src/lib/client-requests/portal.ts only
 *                                    ever writes CLIENT_REQUEST.CREATED
 *                                    (with actorId: null), never
 *                                    STATUS_CHANGED — so this pair is safe
 *                                    even though the *entity* is
 *                                    Portal-reachable.
 *   CLIENT.CREATED                — only src/app/(dashboard)/clients/new/
 *                                    actions.ts (direct creation) and
 *                                    src/app/(dashboard)/leads/actions.ts
 *                                    (Lead -> Client conversion), both
 *                                    Staff Server Actions.
 *
 * Deliberately NOT included, and why (do not add without re-verifying):
 *
 *   QUOTE.STATUS_CHANGED — emitted by BOTH a Staff Server Action
 *     (src/app/(dashboard)/quotes/actions.ts, real actorId) AND a Portal
 *     Server Action (src/app/portal/(app)/quotes/actions.ts, which writes
 *     `actorId: null` by explicit design — see that file's own comment:
 *     "Activity.actor is a relation to the staff [User], never a
 *     PortalUser"). The same (entityType, action) pair is shared between
 *     Staff and Portal with no other discriminator in this phase — unsafe
 *     until a real trust-boundary mechanism is designed for dispatch.
 *   TASK.STATUS_CHANGED — not verified this phase; omitted rather than
 *     guessed at.
 *   Every CREATED/UPDATED pair not listed above — omitted; this phase
 *     intentionally ships the smallest useful allowlist, not an exhaustive
 *     one.
 */

export type WorkflowTriggerFieldKind =
  /** Activity.metadata carries a real {from, to} transition for this field — supports CHANGED_TO/CHANGED_FROM. */
  | "transition"
  /** Activity.metadata carries only the current (post-mutation) value for this field — no "from" exists, so CHANGED_TO/CHANGED_FROM never apply. */
  | "snapshot";

export type WorkflowTriggerFieldDefinition = {
  /** The Activity.metadata key(s) this field reads: {from,to} for "transition", a single key for "snapshot". */
  kind: WorkflowTriggerFieldKind;
  /** Closed, exhaustive set of values this field can take — every allowed value is a real enum member on the underlying model column. */
  allowedValues: readonly string[];
};

export type WorkflowTriggerDefinition = {
  entityType: ActivityEntityType;
  action: ActivityAction;
  /** Human-readable label, descriptive only — never used for matching. */
  label: string;
  /** Fields available to conditions for this trigger, keyed by the condition's own `field`. Deliberately just one field in every V1 trigger — see each trigger's own comment. */
  fields: Readonly<Record<string, WorkflowTriggerFieldDefinition>>;
  /**
   * The CustomFieldEntityType/CustomStatusEntityType this trigger's own
   * entity corresponds to, when it has one — undefined for INVOICE and
   * CLIENT_REQUEST, which are fixed-enum-status entities with no Custom
   * Status/Custom Field support at all (CustomStatusEntityType/
   * CustomFieldEntityType only ever have CLIENT/LEAD/PROJECT members).
   * Actions on a trigger with no customReferenceEntityType may never
   * reference a Custom Status/Custom Field definition (see actions.ts).
   */
  customReferenceEntityType?: "CLIENT" | "LEAD";
};

const LEAD_STAGE_VALUES = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "WON", "LOST"] as const;
const INVOICE_STATUS_VALUES = ["DRAFT", "SENT", "PAID", "OVERDUE", "CANCELLED"] as const;
const CLIENT_REQUEST_STATUS_VALUES = ["OPEN", "IN_PROGRESS", "WAITING_ON_CLIENT", "RESOLVED", "CLOSED"] as const;
const CLIENT_STATUS_VALUES = ["LEAD", "ACTIVE", "INACTIVE", "ARCHIVED"] as const;

/** Ordered so TRIGGER_DEFINITIONS iteration (Object.values) is deterministic — used by listSupportedWorkflowTriggers. */
export const TRIGGER_DEFINITIONS: readonly WorkflowTriggerDefinition[] = [
  {
    entityType: "LEAD",
    action: "STATUS_CHANGED",
    label: "Lead stage changed",
    fields: { status: { kind: "transition", allowedValues: LEAD_STAGE_VALUES } },
    customReferenceEntityType: "LEAD",
  },
  {
    entityType: "INVOICE",
    action: "STATUS_CHANGED",
    label: "Invoice status changed",
    fields: { status: { kind: "transition", allowedValues: INVOICE_STATUS_VALUES } },
    // No customReferenceEntityType — Invoice has no CustomStatusEntityType/
    // CustomFieldEntityType member; its status is a fixed InvoiceStatus
    // enum, never a CustomStatusDefinition.
  },
  {
    entityType: "CLIENT_REQUEST",
    action: "STATUS_CHANGED",
    label: "Client request status changed",
    fields: { status: { kind: "transition", allowedValues: CLIENT_REQUEST_STATUS_VALUES } },
    // No customReferenceEntityType — same reasoning as INVOICE above.
  },
  {
    entityType: "CLIENT",
    action: "CREATED",
    label: "Client created",
    // "snapshot", not "transition" — CREATED has no "from", only the
    // client's status at the moment of creation (see
    // src/lib/activity/client-metadata.ts's own ClientActivityMetadata
    // shape: { name, status, actorName }, never { from, to }).
    fields: { status: { kind: "snapshot", allowedValues: CLIENT_STATUS_VALUES } },
    customReferenceEntityType: "CLIENT",
  },
];

function triggerKey(entityType: ActivityEntityType, action: ActivityAction): string {
  return `${entityType}:${action}`;
}

const TRIGGER_LOOKUP = new Map<string, WorkflowTriggerDefinition>(
  TRIGGER_DEFINITIONS.map((def) => [triggerKey(def.entityType, def.action), def]),
);

/** Returns the trigger definition for a given (entityType, action) pair, or undefined when it isn't in the V1 allowlist. */
export function resolveWorkflowTrigger(
  entityType: ActivityEntityType,
  action: ActivityAction,
): WorkflowTriggerDefinition | undefined {
  return TRIGGER_LOOKUP.get(triggerKey(entityType, action));
}

/** The full V1 trigger allowlist, for authoring UI/API surfaces to enumerate. */
export function listSupportedWorkflowTriggers(): readonly WorkflowTriggerDefinition[] {
  return TRIGGER_DEFINITIONS;
}
