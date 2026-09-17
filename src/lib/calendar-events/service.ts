import "server-only";
import { prisma } from "@/lib/prisma";
import { createActivity } from "@/lib/activity/create-activity";
import type { CalendarEventActor } from "./authorization";
import { resolveCalendarEventTarget, resolveCalendarEventAssignee, type ResolvedCalendarEventTarget } from "./target";
import { resolveWallClockToInstant } from "./timezone";
import { getOrganizationTimezone, getCalendarEventForStaff, type CalendarEventWithRelations } from "./queries";
import {
  parseCalendarEventInput,
  type CalendarEventWritableInput,
  type CalendarEventFieldErrors,
} from "./validation";
import type { PrismaClientOrTx } from "./types";

/**
 * Calendar V1 — every lifecycle/CRUD mutation, mirroring this app's own
 * established domain-module shape exactly (src/lib/contracts/service.ts):
 * authorization checked by the caller (the Server Action, via
 * getCurrentMembership() + canManageCalendarEvents()) before any of these
 * are ever invoked; every read/write scoped by (id, organizationId)
 * together; a discriminated-union result instead of a thrown error for
 * every *expected* outcome; every write guarded by a `updateMany` whose
 * `where` re-asserts organizationId (and, for archive/restore, the exact
 * prior archivedAt state), closing the same class of TOCTOU gap
 * Contract's own guardedTransition() closes — see this module's own
 * archiveCalendarEvent/restoreCalendarEvent for the one place a real
 * "state" needs guarding at all (CalendarEvent has no status/state-
 * machine field the way Contract does, so an ordinary field edit follows
 * Lead/Task/Project's own plain-update precedent instead of Contract's
 * stricter guarded-transition — see updateCalendarEvent's own doc
 * comment).
 */

class CalendarEventRaceError extends Error {}

function dstErrorMessage(reason: "NONEXISTENT" | "AMBIGUOUS"): string {
  return reason === "NONEXISTENT"
    ? "This time doesn't exist for the organization's timezone (a daylight saving time change skips it). Choose a different time."
    : "This time is ambiguous for the organization's timezone (a daylight saving time change repeats it). Choose a different time.";
}

/**
 * Resolves allDay/timed startsAt/endsAt from already-structurally-valid
 * parsed values (validation.ts's own pure output) — the one place this
 * feature's wall-clock ↔ UTC conversion (src/lib/calendar-events/
 * timezone.ts) is actually invoked, always under
 * getOrganizationTimezone()'s own resolved zone, never a browser/server/
 * device default (locked architecture §8/§10). A DST NONEXISTENT/
 * AMBIGUOUS result is surfaced through the exact same `fieldErrors`
 * channel every other validation failure uses — never a distinguishable
 * internal error class or bare exception reaching the caller.
 */
async function resolveTimes(
  organizationId: string,
  values: { allDay: boolean; dateOnly: Date | null; wallStart: import("./timezone").WallClockDateTime | null; wallEnd: import("./timezone").WallClockDateTime | null },
): Promise<{ ok: true; startsAt: Date; endsAt: Date | null } | { ok: false; fieldErrors: CalendarEventFieldErrors }> {
  if (values.allDay) {
    // dateOnly is always set here -- validation.ts only leaves it null
    // when the date itself failed to parse, which parseCalendarEventInput
    // already reports as its own fieldErrors.date (checked by the
    // caller before this function is ever invoked).
    return { ok: true, startsAt: values.dateOnly as Date, endsAt: null };
  }

  const timezone = await getOrganizationTimezone(organizationId);

  const startResolved = resolveWallClockToInstant(values.wallStart!, timezone);
  if (!startResolved.ok) {
    return { ok: false, fieldErrors: { startTime: dstErrorMessage(startResolved.reason) } };
  }

  let endsAt: Date | null = null;
  if (values.wallEnd) {
    const endResolved = resolveWallClockToInstant(values.wallEnd, timezone);
    if (!endResolved.ok) {
      return { ok: false, fieldErrors: { endTime: dstErrorMessage(endResolved.reason) } };
    }
    endsAt = endResolved.instant;
  }

  return { ok: true, startsAt: startResolved.instant, endsAt };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export type CreateCalendarEventResult =
  | { ok: true; event: CalendarEventWithRelations }
  | { ok: false; reason: "VALIDATION"; fieldErrors: CalendarEventFieldErrors }
  | { ok: false; reason: "INVALID_TARGET" }
  | { ok: false; reason: "INVALID_ASSIGNEE" };

export async function createCalendarEvent(
  organizationId: string,
  actor: CalendarEventActor,
  input: CalendarEventWritableInput,
): Promise<CreateCalendarEventResult> {
  const { values, fieldErrors } = parseCalendarEventInput(input);
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, reason: "VALIDATION", fieldErrors };
  }

  const targetResult = await resolveCalendarEventTarget(
    prisma,
    organizationId,
    { type: values.targetType, id: values.targetId },
    null,
  );
  if (!targetResult.ok) {
    return { ok: false, reason: "INVALID_TARGET" };
  }

  const assigneeResult = await resolveCalendarEventAssignee(prisma, organizationId, values.assignedToUserId, null);
  if (!assigneeResult.ok) {
    return { ok: false, reason: "INVALID_ASSIGNEE" };
  }

  const timesResult = await resolveTimes(organizationId, values);
  if (!timesResult.ok) {
    return { ok: false, reason: "VALIDATION", fieldErrors: timesResult.fieldErrors };
  }

  const event = await prisma.$transaction(async (tx) => {
    const created = await tx.calendarEvent.create({
      data: {
        organizationId,
        title: values.title,
        description: values.description,
        location: values.location,
        allDay: values.allDay,
        startsAt: timesResult.startsAt,
        endsAt: timesResult.endsAt,
        clientId: targetResult.target.clientId,
        leadId: targetResult.target.leadId,
        projectId: targetResult.target.projectId,
        assignedToUserId: assigneeResult.assignedToUserId,
        createdByUserId: actor.id,
      },
      include: {
        client: { select: { id: true, name: true } },
        lead: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
        assignedToUser: { select: { id: true, name: true } },
        createdByUser: { select: { id: true, name: true } },
      },
    });

    await createActivity(tx, {
      organizationId,
      actorId: actor.id,
      entityType: "CALENDAR_EVENT",
      entityId: created.id,
      action: "CREATED",
      metadata: { name: created.title },
    });

    return created;
  });

  return { ok: true, event };
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export type UpdateCalendarEventResult =
  | { ok: true; event: CalendarEventWithRelations }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "VALIDATION"; fieldErrors: CalendarEventFieldErrors }
  | { ok: false; reason: "INVALID_TARGET" }
  | { ok: false; reason: "INVALID_ASSIGNEE" };

/**
 * CalendarEvent has no status/state-machine field the way Contract does
 * (see status.ts's own DRAFT/SENT/ACCEPTED/TERMINATED) — there is
 * nothing comparable to guard a DRAFT-only immutability rule against, so
 * this follows Lead/Task/Project's own plain-field-edit precedent
 * instead of Contract's stricter guarded-transition: re-read the current
 * row (organizationId-scoped) first, then write through a guarded
 * `updateMany` that re-asserts (id, organizationId) at the exact write
 * instant — closing the TOCTOU window between this function's own read
 * and write without inventing a fake state to guard on. archivedAt is
 * left untouched by this function entirely (archive/restore are their
 * own separate, dedicated mutations below) — an archived event may still
 * be edited (its content is orthogonal to its archived state, the same
 * "archivedAt is fully separate from status" invariant Contract's own
 * archivedAt already documents).
 */
export async function updateCalendarEvent(
  organizationId: string,
  eventId: string,
  actor: CalendarEventActor,
  input: CalendarEventWritableInput,
): Promise<UpdateCalendarEventResult> {
  const existing = await getCalendarEventForStaff(organizationId, eventId);
  if (!existing) {
    return { ok: false, reason: "NOT_FOUND" };
  }

  const { values, fieldErrors } = parseCalendarEventInput(input);
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, reason: "VALIDATION", fieldErrors };
  }

  const previousTarget: ResolvedCalendarEventTarget = {
    clientId: existing.clientId,
    leadId: existing.leadId,
    projectId: existing.projectId,
  };
  const targetResult = await resolveCalendarEventTarget(
    prisma,
    organizationId,
    { type: values.targetType, id: values.targetId },
    previousTarget,
  );
  if (!targetResult.ok) {
    return { ok: false, reason: "INVALID_TARGET" };
  }

  const assigneeResult = await resolveCalendarEventAssignee(
    prisma,
    organizationId,
    values.assignedToUserId,
    existing.assignedToUserId,
  );
  if (!assigneeResult.ok) {
    return { ok: false, reason: "INVALID_ASSIGNEE" };
  }

  const timesResult = await resolveTimes(organizationId, values);
  if (!timesResult.ok) {
    return { ok: false, reason: "VALIDATION", fieldErrors: timesResult.fieldErrors };
  }

  try {
    const event = await prisma.$transaction(async (tx) => {
      const result = await tx.calendarEvent.updateMany({
        where: { id: eventId, organizationId },
        data: {
          title: values.title,
          description: values.description,
          location: values.location,
          allDay: values.allDay,
          startsAt: timesResult.startsAt,
          endsAt: timesResult.endsAt,
          clientId: targetResult.target.clientId,
          leadId: targetResult.target.leadId,
          projectId: targetResult.target.projectId,
          assignedToUserId: assigneeResult.assignedToUserId,
        },
      });
      if (result.count === 0) {
        throw new CalendarEventRaceError();
      }

      const changedFields: string[] = [];
      if (values.title !== existing.title) changedFields.push("title");
      if (values.description !== existing.description) changedFields.push("description");
      if (values.location !== existing.location) changedFields.push("location");
      if (
        values.allDay !== existing.allDay ||
        timesResult.startsAt.getTime() !== existing.startsAt.getTime() ||
        (timesResult.endsAt?.getTime() ?? null) !== (existing.endsAt?.getTime() ?? null)
      ) {
        changedFields.push("startsAt");
      }
      if (
        targetResult.target.clientId !== previousTarget.clientId ||
        targetResult.target.leadId !== previousTarget.leadId ||
        targetResult.target.projectId !== previousTarget.projectId
      ) {
        changedFields.push("target");
      }
      if (assigneeResult.assignedToUserId !== existing.assignedToUserId) {
        changedFields.push("assignedToUserId");
      }

      if (changedFields.length > 0) {
        await createActivity(tx, {
          organizationId,
          actorId: actor.id,
          entityType: "CALENDAR_EVENT",
          entityId: eventId,
          action: "UPDATED",
          metadata: { name: values.title, changedFields },
        });
      }

      return getCalendarEventForStaff(organizationId, eventId, tx);
    });

    return { ok: true, event: event as CalendarEventWithRelations };
  } catch (err) {
    if (err instanceof CalendarEventRaceError) {
      return { ok: false, reason: "NOT_FOUND" };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Archive / Restore
// ---------------------------------------------------------------------------

export type ArchiveCalendarEventResult =
  | { ok: true; event: CalendarEventWithRelations }
  | { ok: false; reason: "NOT_FOUND" };

export type RestoreCalendarEventResult = ArchiveCalendarEventResult;

/**
 * No hard delete function exists anywhere in this module (locked
 * architecture §13/§22) — archive is the only "removal" this feature
 * ever performs. Idempotent: archiving an already-archived event is a
 * silent no-op (matching archiveContract's own exact precedent),
 * returning the current row without writing a second Activity row. A
 * genuine concurrent double-archive is resolved by the guarded
 * `updateMany` below (`archivedAt: null` re-asserted at the exact write
 * instant) — only whichever call actually flips the row writes the
 * Activity; the loser safely re-reads the now-archived row instead
 * (locked architecture §14: "double archive/restore must be safe/
 * deterministic").
 */
export async function archiveCalendarEvent(
  organizationId: string,
  eventId: string,
  actor: CalendarEventActor,
  client: PrismaClientOrTx = prisma,
): Promise<ArchiveCalendarEventResult> {
  const existing = await getCalendarEventForStaff(organizationId, eventId, client);
  if (!existing) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  if (existing.archivedAt !== null) {
    return { ok: true, event: existing };
  }

  const event = await prisma.$transaction(async (tx) => {
    const result = await tx.calendarEvent.updateMany({
      where: { id: eventId, organizationId, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    if (result.count > 0) {
      await createActivity(tx, {
        organizationId,
        actorId: actor.id,
        entityType: "CALENDAR_EVENT",
        entityId: eventId,
        action: "UPDATED",
        metadata: { name: existing.title, changedFields: ["archivedAt"] },
      });
    }
    return getCalendarEventForStaff(organizationId, eventId, tx);
  });

  return { ok: true, event: event as CalendarEventWithRelations };
}

export async function restoreCalendarEvent(
  organizationId: string,
  eventId: string,
  actor: CalendarEventActor,
  client: PrismaClientOrTx = prisma,
): Promise<RestoreCalendarEventResult> {
  const existing = await getCalendarEventForStaff(organizationId, eventId, client);
  if (!existing) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  if (existing.archivedAt === null) {
    return { ok: true, event: existing };
  }

  const event = await prisma.$transaction(async (tx) => {
    const result = await tx.calendarEvent.updateMany({
      where: { id: eventId, organizationId, archivedAt: { not: null } },
      data: { archivedAt: null },
    });
    if (result.count > 0) {
      await createActivity(tx, {
        organizationId,
        actorId: actor.id,
        entityType: "CALENDAR_EVENT",
        entityId: eventId,
        action: "UPDATED",
        metadata: { name: existing.title, changedFields: ["archivedAt"] },
      });
    }
    return getCalendarEventForStaff(organizationId, eventId, tx);
  });

  return { ok: true, event: event as CalendarEventWithRelations };
}
