// Client Requests / Tickets, Phase 1. Mirrors lead-metadata.ts's own
// discipline exactly: every editable field's NAME can appear inside a
// changedFields diff array (never its value); the metadata's own top-
// level, always-present fields are limited to what a list/badge UI would
// already show (title, status). `description` values never appear
// anywhere in Activity.metadata.
//
// No diffClientRequestFields helper here (unlike diffLeadFields) — this
// phase's own Staff domain layer (src/lib/client-requests/staff.ts) has
// no generic "update everything" function, only single-field updaters
// (status/priority/assignedToId/projectId) that each already know
// exactly which one field changed and pass it directly (e.g.
// `["priority"]`). A snapshot-diff helper would have no caller in this
// phase — add one alongside whichever future phase actually needs it.

export type ClientRequestActivityMetadata = {
  title: string;
  status: string;
  actorName: string;
  /** Only present on UPDATED — field names that changed, never their values. */
  changedFields?: string[];
};

export type ClientRequestStatusChangeMetadata = {
  from: string;
  to: string;
};

export function buildClientRequestActivityMetadata(
  request: { title: string; status: string },
  actorName: string,
  changedFields?: string[],
): ClientRequestActivityMetadata {
  return {
    title: request.title,
    status: request.status,
    actorName,
    ...(changedFields ? { changedFields } : {}),
  };
}

export function buildClientRequestStatusChangeMetadata(from: string, to: string): ClientRequestStatusChangeMetadata {
  return { from, to };
}
