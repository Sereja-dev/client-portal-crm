import { parseDateOnly } from "@/lib/invoices/date-only";
import { isUuid } from "@/lib/validation/lead";
import type { WallClockDateTime } from "./timezone";

/**
 * Calendar V1. Plain-object input, not FormData, matching Contract's own
 * exact precedent (src/lib/contracts/validation.ts's own header comment)
 * — the create/edit dialog builds this shape from its own form state.
 *
 * Structural/format parsing only — this module never touches the
 * database and never resolves a wall-clock time into a UTC instant
 * (that needs OrganizationProfile.timezone, a DB read, and is
 * deliberately kept out of this pure module — see service.ts, which
 * calls getOrganizationTimezone() then resolveWallClockToInstant()).
 * Target/assignee *ownership* is resolved and enforced separately by
 * service.ts's own target/assignee revalidation (the real authorization
 * boundary), never re-derived here.
 *
 * Locked V1 simplification (readiness audit + this phase's own task
 * spec §11/§20): every event — timed or all-day — spans exactly one
 * calendar date. There is no separate "end date" field; a timed event's
 * optional end time is on the SAME date as its start time. This is a
 * deliberate scope decision, not an oversight — see this module's own
 * end-after-start check below.
 */

// Matches CONTRACT_TITLE_MAX_LENGTH/QUOTE_TITLE_MAX_LENGTH exactly — a
// real event title, not an essay.
export const CALENDAR_EVENT_TITLE_MAX_LENGTH = 200;
// Matches CLIENT_NOTES_MAX_LENGTH/QUOTE_NOTES_MAX_LENGTH/
// CONTRACT_INTERNAL_NOTES_MAX_LENGTH exactly — this app's one existing
// "large freeform text" convention.
export const CALENDAR_EVENT_DESCRIPTION_MAX_LENGTH = 10_000;
// A single-line field (an address or a video-call URL) — bounded much
// more tightly than a freeform notes field, matching this app's own
// "short reference field" tier (CONTRACT_NUMBER_MAX_LENGTH is 50; a
// location needs more room than a reference number but is still never a
// paragraph).
export const CALENDAR_EVENT_LOCATION_MAX_LENGTH = 300;

export const CALENDAR_EVENT_TARGET_TYPES = ["NONE", "CLIENT", "LEAD", "PROJECT"] as const;
export type CalendarEventTargetType = (typeof CALENDAR_EVENT_TARGET_TYPES)[number];

export type CalendarEventFieldErrors = Partial<
  Record<
    "title" | "description" | "location" | "date" | "startTime" | "endTime" | "targetType" | "targetId" | "assignedToUserId",
    string
  >
>;

export type CalendarEventWritableInput = {
  title: unknown;
  description?: unknown;
  location?: unknown;
  /** Truthy/"true"/"on"/boolean true all count as all-day — matches this app's own checkbox-parsing convention for a plain (non-FormData) input. */
  allDay: unknown;
  /** "YYYY-MM-DD" — the single calendar date this event falls on, all-day or timed alike. */
  date: unknown;
  /** "HH:MM", 24-hour — required when allDay is false, ignored when true. */
  startTime?: unknown;
  /** "HH:MM", 24-hour — optional even when timed. */
  endTime?: unknown;
  targetType?: unknown;
  targetId?: unknown;
  assignedToUserId?: unknown;
};

export type ParsedCalendarEventValues = {
  title: string;
  description: string | null;
  location: string | null;
  allDay: boolean;
  /** Set only when allDay is true — the UTC-midnight date-only value, already fully resolved (parseDateOnly is pure and timezone-agnostic by construction). */
  dateOnly: Date | null;
  /** Set only when allDay is false — the raw wall-clock components service.ts must still resolve via resolveWallClockToInstant() under the organization's own timezone. */
  wallStart: WallClockDateTime | null;
  wallEnd: WallClockDateTime | null;
  targetType: CalendarEventTargetType;
  targetId: string | null;
  assignedToUserId: string | null;
};

function trimmedOrNull(value: unknown): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  return value === "true" || value === "on" || value === "1";
}

const TIME_PATTERN = /^([0-1]\d|2[0-3]):([0-5]\d)$/;

function parseTimeOfDay(raw: string): { hour: number; minute: number } | null {
  const match = TIME_PATTERN.exec(raw);
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function parseCalendarEventInput(input: CalendarEventWritableInput): {
  values: ParsedCalendarEventValues;
  fieldErrors: CalendarEventFieldErrors;
} {
  const fieldErrors: CalendarEventFieldErrors = {};

  const title = trimmedOrNull(input.title) ?? "";
  if (!title) {
    fieldErrors.title = "Title is required.";
  } else if (title.length > CALENDAR_EVENT_TITLE_MAX_LENGTH) {
    fieldErrors.title = `Must be ${CALENDAR_EVENT_TITLE_MAX_LENGTH} characters or fewer.`;
  }

  const description = trimmedOrNull(input.description);
  if (description && description.length > CALENDAR_EVENT_DESCRIPTION_MAX_LENGTH) {
    fieldErrors.description = `Must be ${CALENDAR_EVENT_DESCRIPTION_MAX_LENGTH} characters or fewer.`;
  }

  const location = trimmedOrNull(input.location);
  if (location && location.length > CALENDAR_EVENT_LOCATION_MAX_LENGTH) {
    fieldErrors.location = `Must be ${CALENDAR_EVENT_LOCATION_MAX_LENGTH} characters or fewer.`;
  }

  const allDay = parseBoolean(input.allDay);

  const dateRaw = trimmedOrNull(input.date) ?? "";
  const dateParsed = parseDateOnly(dateRaw);
  if (!dateParsed.ok) {
    fieldErrors.date = "Enter a valid date.";
  }

  let dateOnly: Date | null = null;
  let wallStart: WallClockDateTime | null = null;
  let wallEnd: WallClockDateTime | null = null;

  if (dateParsed.ok) {
    if (allDay) {
      dateOnly = dateParsed.date;
    } else {
      const startRaw = trimmedOrNull(input.startTime) ?? "";
      const startParsed = parseTimeOfDay(startRaw);
      if (!startParsed) {
        fieldErrors.startTime = "Enter a valid start time.";
      } else {
        wallStart = {
          year: dateParsed.date.getUTCFullYear(),
          month: dateParsed.date.getUTCMonth() + 1,
          day: dateParsed.date.getUTCDate(),
          hour: startParsed.hour,
          minute: startParsed.minute,
        };
      }

      const endRaw = trimmedOrNull(input.endTime);
      if (endRaw) {
        const endParsed = parseTimeOfDay(endRaw);
        if (!endParsed) {
          fieldErrors.endTime = "Enter a valid end time.";
        } else {
          wallEnd = {
            year: dateParsed.date.getUTCFullYear(),
            month: dateParsed.date.getUTCMonth() + 1,
            day: dateParsed.date.getUTCDate(),
            hour: endParsed.hour,
            minute: endParsed.minute,
          };
          // Same-day-only (locked V1 simplification, see this module's
          // own header comment) — comparing minutes-of-day directly is
          // sufficient and needs no timezone resolution at all.
          if (wallStart && wallEnd.hour * 60 + wallEnd.minute <= wallStart.hour * 60 + wallStart.minute) {
            fieldErrors.endTime = "End time must be after the start time.";
          }
        }
      }
    }
  }

  const targetTypeRaw = trimmedOrNull(input.targetType) ?? "NONE";
  const targetType: CalendarEventTargetType = (CALENDAR_EVENT_TARGET_TYPES as readonly string[]).includes(targetTypeRaw)
    ? (targetTypeRaw as CalendarEventTargetType)
    : "NONE";

  const targetIdRaw = trimmedOrNull(input.targetId);
  let targetId: string | null = null;
  if (targetType === "NONE") {
    // A targetId supplied alongside targetType "NONE" is simply ignored,
    // never an error -- "no target" is unambiguous regardless of what
    // else was sent (locked target invariant: the service layer is the
    // real authority either way, see calendar-events/target.ts).
    targetId = null;
  } else if (!targetIdRaw) {
    fieldErrors.targetId = "Select a record.";
  } else if (!isUuid(targetIdRaw)) {
    fieldErrors.targetId = "Select a valid record.";
  } else {
    targetId = targetIdRaw;
  }

  const assignedToUserIdRaw = trimmedOrNull(input.assignedToUserId);
  let assignedToUserId: string | null = null;
  if (assignedToUserIdRaw !== null) {
    if (!isUuid(assignedToUserIdRaw)) {
      fieldErrors.assignedToUserId = "Select a valid team member.";
    } else {
      assignedToUserId = assignedToUserIdRaw;
    }
  }

  return {
    values: {
      title,
      description,
      location,
      allDay,
      dateOnly,
      wallStart,
      wallEnd,
      targetType,
      targetId,
      assignedToUserId,
    },
    fieldErrors,
  };
}

export function hasCalendarEventFormErrors(fieldErrors: CalendarEventFieldErrors): boolean {
  return Object.keys(fieldErrors).length > 0;
}
