import "server-only";
import type { TimeEntry } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import type { PrismaClientOrTx } from "./types";
import { createActivity } from "@/lib/activity/create-activity";
import { buildTimeEntryActivityMetadata, diffTimeEntryFields } from "@/lib/activity/time-entry-metadata";
import { isUuid, parseTimeEntryFields, type TimeEntryFieldErrors } from "@/lib/validation/time-entry";

/**
 * Time Tracking, Phase 1 — domain layer. Every function here is
 * organization-scoped exactly like Client Requests'/Lead Capture Forms'
 * own domain modules: a foreign-org id is always treated as nonexistent,
 * never a distinguishable "exists but denied" case. No Server Action or
 * UI layer exists yet in this phase (foundation-first, matching every
 * other Phase 1 this session) — callers resolve `organizationId` and
 * `actor` from an authenticated session themselves, and are exercised
 * directly by integration tests.
 *
 * Ownership: userId/projectId/taskId are all nullable at the database
 * level (see TimeEntry's own schema doc comment — historical
 * preservation once their own owning row is deleted), but
 * createTimeEntry always REQUIRES a valid target Membership and a valid
 * Project; the database's own nullability is never a loophole this
 * domain layer's own create path can produce — only a Project/User/Task
 * row's own later deletion (an FK SetNull, never a domain action) can
 * ever null one of these columns on an existing entry.
 *
 * Permission model (Section "AUTHORIZATION" of the approved spec):
 *   - Any organization member may create/update/archive/unarchive their
 *     own TimeEntry (target/existing userId === actor.id).
 *   - Only OWNER/ADMIN may create/update/archive/unarchive a TimeEntry
 *     belonging to (or being reassigned to/from) a different member.
 *   - A MEMBER can never reassign a TimeEntry to a different userId at
 *     all, even their own entry, and even when acting on their own
 *     current entry — reassignment is always an OWNER/ADMIN-only
 *     operation, re-evaluated independently of whichever base
 *     "own vs. other" check already passed.
 */

export type TimeEntryActor = { id: string; name: string; role: Role };

export type TimeEntryMutationResult = { ok: true; entry: TimeEntry } | { ok: false; reason: "ENTRY_NOT_FOUND" };

function isPrivileged(role: Role): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Verifies `userId` holds a real Membership in `organizationId` — same pattern as Lead's own verifyAssigneeInOrganization / Client Requests' own verifyMembership. */
async function verifyMembership(userId: string, organizationId: string, client: PrismaClientOrTx): Promise<boolean> {
  const membership = await client.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: { userId: true },
  });
  return membership !== null;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export type CreateTimeEntryInput = {
  /** The member this entry is logged for — required, never inferred. */
  userId: unknown;
  /** Required — createTimeEntry never creates a project-less entry (see this module's own header comment). */
  projectId: unknown;
  /** Optional — null/undefined both mean "no task". */
  taskId?: unknown;
  workDate: unknown;
  durationMinutes: unknown;
  description?: unknown;
  billable?: boolean;
};

export type CreateTimeEntryResult =
  | { ok: true; entry: TimeEntry }
  | { ok: false; reason: "VALIDATION"; fieldErrors: TimeEntryFieldErrors }
  | { ok: false; reason: "FORBIDDEN" }
  | { ok: false; reason: "INVALID_TARGET_USER" }
  | { ok: false; reason: "INVALID_PROJECT" }
  | { ok: false; reason: "INVALID_TASK" };

export async function createTimeEntry(
  organizationId: string,
  actor: TimeEntryActor,
  input: CreateTimeEntryInput,
  client: PrismaClientOrTx = prisma,
): Promise<CreateTimeEntryResult> {
  const fieldErrors: TimeEntryFieldErrors = {};

  if (!isUuid(input.userId)) {
    fieldErrors.userId = "Select a valid team member.";
  }
  if (!isUuid(input.projectId)) {
    fieldErrors.projectId = "Select a valid project.";
  }
  if (input.taskId !== undefined && input.taskId !== null && !isUuid(input.taskId)) {
    fieldErrors.taskId = "Select a valid task.";
  }

  const fields = parseTimeEntryFields(input);
  if (!fields.ok) {
    Object.assign(fieldErrors, fields.fieldErrors);
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, reason: "VALIDATION", fieldErrors };
  }
  const values = fields as { ok: true; values: { workDate: Date; durationMinutes: number; description: string | null } };

  const targetUserId = input.userId as string;
  const projectId = input.projectId as string;
  const taskId = (input.taskId as string | null | undefined) ?? null;

  // Authorization — checked before any DB read beyond what's already
  // happened, so an unauthorized MEMBER never learns whether the target
  // user/project/task even exist in this organization.
  const isOwnEntry = targetUserId === actor.id;
  if (!isOwnEntry && !isPrivileged(actor.role)) {
    return { ok: false, reason: "FORBIDDEN" };
  }

  if (!(await verifyMembership(targetUserId, organizationId, client))) {
    return { ok: false, reason: "INVALID_TARGET_USER" };
  }

  // Same "actual existing organization ownership semantics" every
  // current Project domain/action already uses (Project.organizationId
  // is nullable at the schema level, but every real row is populated —
  // see projects/[id]/edit/page.tsx's own identical findFirst) — no
  // invented fallback.
  const project = await client.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true } });
  if (!project) {
    return { ok: false, reason: "INVALID_PROJECT" };
  }

  if (taskId) {
    const task = await client.task.findFirst({ where: { id: taskId, organizationId, projectId }, select: { id: true } });
    if (!task) {
      return { ok: false, reason: "INVALID_TASK" };
    }
  }

  const runCreate = async (tx: PrismaClientOrTx) => {
    const created = await tx.timeEntry.create({
      data: {
        organizationId,
        userId: targetUserId,
        projectId,
        taskId,
        workDate: values.values.workDate,
        durationMinutes: values.values.durationMinutes,
        description: values.values.description,
        billable: input.billable ?? true,
      },
    });

    await createActivity(tx, {
      organizationId,
      actorId: actor.id,
      entityType: "TIME_ENTRY",
      entityId: created.id,
      action: "CREATED",
      metadata: buildTimeEntryActivityMetadata(created, actor.name),
    });

    return created;
  };

  const entry = client === prisma ? await prisma.$transaction((tx) => runCreate(tx)) : await runCreate(client);
  return { ok: true, entry };
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export type UpdateTimeEntryInput = {
  /** Reassignment — omit entirely for "no change". */
  userId?: unknown;
  /** Change the linked Project — omit entirely for "no change". Never accepts null (a TimeEntry can't be unlinked from every Project via this action — only an FK SetNull from a Project's own deletion can do that). */
  projectId?: unknown;
  /** Change/clear the linked Task — omit for "no change", explicit null clears it. */
  taskId?: unknown;
  workDate?: unknown;
  durationMinutes?: unknown;
  description?: unknown;
  billable?: boolean;
};

export type UpdateTimeEntryResult =
  | { ok: true; entry: TimeEntry }
  | { ok: false; reason: "ENTRY_NOT_FOUND" }
  | { ok: false; reason: "VALIDATION"; fieldErrors: TimeEntryFieldErrors }
  | { ok: false; reason: "FORBIDDEN" }
  | { ok: false; reason: "INVALID_TARGET_USER" }
  | { ok: false; reason: "INVALID_PROJECT" }
  | { ok: false; reason: "INVALID_TASK" }
  | { ok: false; reason: "TASK_PROJECT_MISMATCH" };

export async function updateTimeEntry(
  organizationId: string,
  entryId: string,
  actor: TimeEntryActor,
  input: UpdateTimeEntryInput,
  client: PrismaClientOrTx = prisma,
): Promise<UpdateTimeEntryResult> {
  const existing = await client.timeEntry.findFirst({ where: { id: entryId, organizationId } });
  if (!existing) {
    return { ok: false, reason: "ENTRY_NOT_FOUND" };
  }

  const fieldErrors: TimeEntryFieldErrors = {};

  const userIdProvided = input.userId !== undefined;
  if (userIdProvided && !isUuid(input.userId)) {
    fieldErrors.userId = "Select a valid team member.";
  }

  const projectIdProvided = input.projectId !== undefined;
  if (projectIdProvided && !isUuid(input.projectId)) {
    fieldErrors.projectId = "Select a valid project.";
  }

  const taskIdProvided = input.taskId !== undefined;
  if (taskIdProvided && input.taskId !== null && !isUuid(input.taskId)) {
    fieldErrors.taskId = "Select a valid task.";
  }

  const fields = parseTimeEntryFields({
    workDate: input.workDate ?? existing.workDate.toISOString().slice(0, 10),
    durationMinutes: input.durationMinutes ?? existing.durationMinutes,
    description: input.description !== undefined ? input.description : existing.description,
  });
  if (!fields.ok) {
    // Only surface an error for a field this call actually touched —
    // parseTimeEntryFields validates all three together (it has no
    // partial mode of its own), but re-parsing the *existing* value for
    // an untouched field can never itself fail (it was already valid
    // when persisted), so any fieldError here genuinely traces back to
    // an explicitly-provided value.
    Object.assign(fieldErrors, fields.fieldErrors);
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, reason: "VALIDATION", fieldErrors };
  }
  const values = (fields as { ok: true; values: { workDate: Date; durationMinutes: number; description: string | null } }).values;

  // Authorization — base check against who currently owns this entry.
  // existing.userId can be null (the previous owner's User row was
  // itself hard-deleted, SetNull) — a null current owner is never
  // treated as "mine" by anyone, only OWNER/ADMIN can touch it.
  const isCurrentlyOwnEntry = existing.userId !== null && existing.userId === actor.id;
  if (!isCurrentlyOwnEntry && !isPrivileged(actor.role)) {
    return { ok: false, reason: "FORBIDDEN" };
  }

  // Reassignment — always independently re-evaluated, regardless of the
  // base check above: a MEMBER can never reassign a TimeEntry to a
  // different userId, even their own.
  const targetUserId = userIdProvided ? (input.userId as string) : existing.userId;
  const isReassigning = userIdProvided && targetUserId !== existing.userId;
  if (isReassigning && !isPrivileged(actor.role)) {
    return { ok: false, reason: "FORBIDDEN" };
  }
  if (isReassigning) {
    if (!targetUserId || !(await verifyMembership(targetUserId, organizationId, client))) {
      return { ok: false, reason: "INVALID_TARGET_USER" };
    }
  }

  // Project/Task resolution — "Project change revalidates existing/new
  // task compatibility" (Section "TASK VALIDATION"): rejection is
  // preferred over silent auto-clearing, per the approved spec.
  const effectiveProjectId = projectIdProvided ? (input.projectId as string) : existing.projectId;

  if (projectIdProvided) {
    const project = await client.project.findFirst({ where: { id: input.projectId as string, organizationId }, select: { id: true } });
    if (!project) {
      return { ok: false, reason: "INVALID_PROJECT" };
    }
  }

  let effectiveTaskId: string | null;
  if (taskIdProvided) {
    effectiveTaskId = (input.taskId as string | null) ?? null;
    if (effectiveTaskId) {
      const task = await client.task.findFirst({
        where: { id: effectiveTaskId, organizationId, projectId: effectiveProjectId ?? undefined },
        select: { id: true },
      });
      if (!task) {
        return { ok: false, reason: "INVALID_TASK" };
      }
    }
  } else {
    effectiveTaskId = existing.taskId;
    // The project changed, taskId itself was NOT explicitly addressed in
    // this same update, and there IS an existing task — it must still
    // belong to the new project, or this update is rejected outright
    // (never silently cleared).
    if (projectIdProvided && effectiveTaskId) {
      const task = await client.task.findFirst({
        where: { id: effectiveTaskId, organizationId, projectId: effectiveProjectId ?? undefined },
        select: { id: true },
      });
      if (!task) {
        return { ok: false, reason: "TASK_PROJECT_MISMATCH" };
      }
    }
  }

  const afterSnapshot = {
    userId: targetUserId,
    projectId: effectiveProjectId,
    taskId: effectiveTaskId,
    workDate: values.workDate,
    durationMinutes: values.durationMinutes,
    description: values.description,
    billable: input.billable ?? existing.billable,
  };
  const changedFields = diffTimeEntryFields(existing, afterSnapshot);

  if (changedFields.length === 0) {
    // Idempotent no-op — same convention as archiveClientRequest/
    // unarchiveLeadCaptureForm's own "already in this state" returns:
    // no write, no Activity row.
    return { ok: true, entry: existing };
  }

  const runUpdate = async (tx: PrismaClientOrTx) => {
    const updated = await tx.timeEntry.update({
      where: { id: entryId },
      data: afterSnapshot,
    });

    await createActivity(tx, {
      organizationId,
      actorId: actor.id,
      entityType: "TIME_ENTRY",
      entityId: entryId,
      action: "UPDATED",
      metadata: buildTimeEntryActivityMetadata(updated, actor.name, changedFields),
    });

    return updated;
  };

  const entry = client === prisma ? await prisma.$transaction((tx) => runUpdate(tx)) : await runUpdate(client);
  return { ok: true, entry };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getTimeEntry(organizationId: string, entryId: string, client: PrismaClientOrTx = prisma): Promise<TimeEntry | null> {
  return client.timeEntry.findFirst({ where: { id: entryId, organizationId } });
}

export type ListTimeEntriesOptions = {
  userId?: string;
  projectId?: string;
  fromDate?: Date;
  toDate?: Date;
  billable?: boolean;
  includeArchived?: boolean;
};

/**
 * `userId`/`projectId` filters are never separately re-validated against
 * "does this belong to the organization" — the compound WHERE below
 * already makes that safe by construction (a foreign-org id simply
 * matches zero rows, the same as every other optional-filter list
 * function in this app — see listOrganizationClientRequests' own
 * identical shape); no caller can ever see another organization's data
 * through this filter regardless of what id it names.
 */
export async function listTimeEntries(
  organizationId: string,
  options: ListTimeEntriesOptions = {},
  client: PrismaClientOrTx = prisma,
): Promise<TimeEntry[]> {
  return client.timeEntry.findMany({
    where: {
      organizationId,
      ...(options.includeArchived ? {} : { archivedAt: null }),
      ...(options.userId ? { userId: options.userId } : {}),
      ...(options.projectId ? { projectId: options.projectId } : {}),
      ...(options.billable !== undefined ? { billable: options.billable } : {}),
      ...(options.fromDate || options.toDate
        ? {
            workDate: {
              ...(options.fromDate ? { gte: options.fromDate } : {}),
              ...(options.toDate ? { lte: options.toDate } : {}),
            },
          }
        : {}),
    },
    // Newest workDate first, then a deterministic tie-breaker — same
    // "createdAt/id" tie-break shape as every other newest-first list in
    // this app (e.g. Activity's own @@index([organizationId, createdAt, id])).
    orderBy: [{ workDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
  });
}

// ---------------------------------------------------------------------------
// Archive / unarchive
// ---------------------------------------------------------------------------

async function setArchivedState(
  organizationId: string,
  entryId: string,
  actor: TimeEntryActor,
  archived: boolean,
  client: PrismaClientOrTx,
): Promise<TimeEntryMutationResult | { ok: false; reason: "FORBIDDEN" }> {
  const existing = await client.timeEntry.findFirst({ where: { id: entryId, organizationId } });
  if (!existing) {
    return { ok: false, reason: "ENTRY_NOT_FOUND" };
  }

  const isOwnEntry = existing.userId !== null && existing.userId === actor.id;
  if (!isOwnEntry && !isPrivileged(actor.role)) {
    return { ok: false, reason: "FORBIDDEN" };
  }

  const alreadyInState = archived ? existing.archivedAt !== null : existing.archivedAt === null;
  if (alreadyInState) {
    return { ok: true, entry: existing };
  }

  // No Activity row — archiving is a visibility/housekeeping action, not
  // a lifecycle event this phase's own "CREATED and meaningful UPDATED
  // only" rule includes (same choice Client Requests' own
  // archiveClientRequest already made).
  const entry = await client.timeEntry.update({ where: { id: entryId }, data: { archivedAt: archived ? new Date() : null } });
  return { ok: true, entry };
}

export async function archiveTimeEntry(
  organizationId: string,
  entryId: string,
  actor: TimeEntryActor,
  client: PrismaClientOrTx = prisma,
): Promise<TimeEntryMutationResult | { ok: false; reason: "FORBIDDEN" }> {
  return setArchivedState(organizationId, entryId, actor, true, client);
}

export async function unarchiveTimeEntry(
  organizationId: string,
  entryId: string,
  actor: TimeEntryActor,
  client: PrismaClientOrTx = prisma,
): Promise<TimeEntryMutationResult | { ok: false; reason: "FORBIDDEN" }> {
  return setArchivedState(organizationId, entryId, actor, false, client);
}
