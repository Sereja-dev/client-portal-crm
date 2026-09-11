import { formatDateOnly } from "@/lib/invoices/date-only";

// Time Tracking, Phase 1. Mirrors lead-metadata.ts's own discipline
// exactly: every editable field's NAME can appear inside a changedFields
// diff array (never its value); the metadata's own top-level, always-
// present fields are limited to what a list/badge UI would already show
// (workDate, durationMinutes, billable — none of them sensitive).
// `description` values never appear anywhere in Activity.metadata, only
// its field NAME as a changedFields entry when it changed — same
// treatment Lead.notes/ClientRequest.description already get.
// `userId`/`projectId`/`taskId` values also never appear — only their
// field NAMES, when a create/reassign/relink changed them.

const TIME_ENTRY_TRACKED_FIELDS = ["userId", "projectId", "taskId", "workDate", "durationMinutes", "description", "billable"] as const;

type TimeEntryTrackedSnapshot = {
  userId: string | null;
  projectId: string | null;
  taskId: string | null;
  workDate: Date;
  durationMinutes: number;
  description: string | null;
  billable: boolean;
};

export type TimeEntryActivityMetadata = {
  workDate: string;
  durationMinutes: number;
  billable: boolean;
  actorName: string;
  /** Only present on UPDATED — field names that changed, never their values. */
  changedFields?: string[];
};

/** Field names (never values) that differ between two TimeEntry snapshots — mirrors diffLeadFields exactly. */
export function diffTimeEntryFields(before: TimeEntryTrackedSnapshot, after: TimeEntryTrackedSnapshot): string[] {
  return TIME_ENTRY_TRACKED_FIELDS.filter((field) => {
    if (field === "workDate") {
      return before.workDate.getTime() !== after.workDate.getTime();
    }
    return before[field] !== after[field];
  });
}

export function buildTimeEntryActivityMetadata(
  entry: { workDate: Date; durationMinutes: number; billable: boolean },
  actorName: string,
  changedFields?: string[],
): TimeEntryActivityMetadata {
  return {
    workDate: formatDateOnly(entry.workDate),
    durationMinutes: entry.durationMinutes,
    billable: entry.billable,
    actorName,
    ...(changedFields ? { changedFields } : {}),
  };
}
