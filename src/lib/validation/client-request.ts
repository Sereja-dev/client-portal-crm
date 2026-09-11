/**
 * Client Requests / Tickets, Phase 1 (foundation). Mirrors
 * src/lib/validation/lead.ts's own conventions exactly where they apply
 * (trim-then-required, explicit max lengths, "field name -> error
 * message" fieldErrors shape). Message body validation is NOT duplicated
 * here — src/lib/client-requests/messages.ts imports
 * validateCommentBody/COMMENT_BODY_MAX_LENGTH from
 * src/lib/comments/validate-body.ts directly, which is already a plain,
 * entity-agnostic function ("organizationId/authorId/... are never
 * parameters here" per its own doc comment).
 */

export const CLIENT_REQUEST_TITLE_MAX_LENGTH = 200;
export const CLIENT_REQUEST_DESCRIPTION_MAX_LENGTH = 10_000;

export const CLIENT_REQUEST_STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_ON_CLIENT", "RESOLVED", "CLOSED"] as const;
export type ClientRequestStatusValue = (typeof CLIENT_REQUEST_STATUSES)[number];

export function isClientRequestStatus(value: unknown): value is ClientRequestStatusValue {
  return typeof value === "string" && (CLIENT_REQUEST_STATUSES as readonly string[]).includes(value);
}

// "Terminal/administrative closure" per this phase's own approved spec —
// used only by updateClientRequestStatus's own resolvedAt bookkeeping
// (see staff.ts), never to block a transition: a request remains
// reopenable from RESOLVED (and, deliberately, from CLOSED too — this
// phase draws no hard "can never leave CLOSED" rule; see staff.ts's own
// comment on why every status -> status transition is allowed in V1).
export const TERMINAL_CLIENT_REQUEST_STATUSES: readonly ClientRequestStatusValue[] = ["RESOLVED", "CLOSED"];

export const CLIENT_REQUEST_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type ClientRequestPriorityValue = (typeof CLIENT_REQUEST_PRIORITIES)[number];

export function isClientRequestPriority(value: unknown): value is ClientRequestPriorityValue {
  return typeof value === "string" && (CLIENT_REQUEST_PRIORITIES as readonly string[]).includes(value);
}

// Client Requests Phase 1 §"PRIORITY V1" — Preferred V1 option: a Portal
// visitor may pick LOW/NORMAL/HIGH but never URGENT, which is reserved
// for Staff to set (via updateClientRequestPriority). This is the actual
// escalation signal Staff triage on — letting every client self-declare
// URGENT would make it meaningless, the same "don't expose internal
// escalation mechanics" instruction this phase's own spec states
// explicitly.
export const PORTAL_SELECTABLE_CLIENT_REQUEST_PRIORITIES = ["LOW", "NORMAL", "HIGH"] as const;
export type PortalSelectableClientRequestPriorityValue = (typeof PORTAL_SELECTABLE_CLIENT_REQUEST_PRIORITIES)[number];

export function isPortalSelectableClientRequestPriority(value: unknown): value is PortalSelectableClientRequestPriorityValue {
  return typeof value === "string" && (PORTAL_SELECTABLE_CLIENT_REQUEST_PRIORITIES as readonly string[]).includes(value);
}

function trimmedOrNull(value: unknown): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

export type ClientRequestFieldErrors = Partial<Record<"title" | "description" | "priority" | "projectId", string>>;

export type ParsedClientRequestCreateInput = {
  title: string;
  description: string;
  priority: ClientRequestPriorityValue;
  projectId: string | null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * Shared title/description/projectId(format only)/priority parsing for
 * both the Portal and Staff create paths — `allowedPriorities` is the
 * one thing that differs between them (see
 * PORTAL_SELECTABLE_CLIENT_REQUEST_PRIORITIES above), passed in rather
 * than hardcoded so this one function serves both callers.
 *
 * `projectId` is validated for FORMAT only (a well-formed UUID) — whether
 * it actually belongs to this organization AND this client is a database
 * check the caller (portal.ts/staff.ts) performs separately, since that
 * requires a read this pure parser deliberately never does (same
 * division of responsibility as parseLeadInput's own
 * assignedToUserId comment).
 */
export function parseClientRequestCreateInput(
  input: { title: unknown; description: unknown; priority?: unknown; projectId?: unknown },
  allowedPriorities: readonly ClientRequestPriorityValue[],
): { ok: true; values: ParsedClientRequestCreateInput } | { ok: false; fieldErrors: ClientRequestFieldErrors } {
  const title = String(input.title ?? "").trim();
  const description = String(input.description ?? "").trim();
  const projectId = trimmedOrNull(input.projectId);

  const fieldErrors: ClientRequestFieldErrors = {};

  if (!title) {
    fieldErrors.title = "Title is required.";
  } else if (title.length > CLIENT_REQUEST_TITLE_MAX_LENGTH) {
    fieldErrors.title = `Must be ${CLIENT_REQUEST_TITLE_MAX_LENGTH} characters or fewer.`;
  }

  if (!description) {
    fieldErrors.description = "Description is required.";
  } else if (description.length > CLIENT_REQUEST_DESCRIPTION_MAX_LENGTH) {
    fieldErrors.description = `Must be ${CLIENT_REQUEST_DESCRIPTION_MAX_LENGTH} characters or fewer.`;
  }

  let priority: ClientRequestPriorityValue = "NORMAL";
  if (input.priority !== undefined && input.priority !== null && input.priority !== "") {
    if ((allowedPriorities as readonly string[]).includes(String(input.priority))) {
      priority = input.priority as ClientRequestPriorityValue;
    } else {
      fieldErrors.priority = "Select a valid priority.";
    }
  }

  if (projectId && !isUuid(projectId)) {
    fieldErrors.projectId = "Select a valid project.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  return { ok: true, values: { title, description, priority, projectId } };
}

/**
 * resolvedAt bookkeeping for a status transition — mirrors
 * src/lib/validation/task.ts's own deriveCompletedAt exactly in spirit:
 *   - Moving TO RESOLVED sets it, unless it's already set (re-saving an
 *     already-RESOLVED request never bumps the timestamp).
 *   - Moving TO CLOSED leaves it exactly as it was — CLOSED never sets or
 *     clears resolvedAt on its own; a request closed directly from OPEN/
 *     IN_PROGRESS/WAITING_ON_CLIENT (never having been RESOLVED) simply
 *     stays null.
 *   - Moving to any other status (a "reopen") always clears it.
 */
export function deriveClientRequestResolvedAt(
  newStatus: ClientRequestStatusValue,
  currentResolvedAt: Date | null,
): Date | null {
  if (newStatus === "RESOLVED") {
    return currentResolvedAt ?? new Date();
  }
  if (newStatus === "CLOSED") {
    return currentResolvedAt;
  }
  return null;
}
