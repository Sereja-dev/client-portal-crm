import "server-only";
import { prisma } from "@/lib/prisma";
import { deriveCompletedAt, TASK_STATUSES, TASK_PRIORITIES, type TaskStatusValue, type TaskPriorityValue } from "@/lib/validation/task";
import { createActivity } from "@/lib/activity/create-activity";
import { buildTaskStatusChangedMetadata, buildTaskUpdatedMetadata } from "@/lib/activity/task-metadata";

/**
 * Projects & Tasks Work Hub V1 — the one shared, narrow Task-mutation
 * domain layer for the two new surfaces that change a single field at a
 * time (Task Board's drag-and-drop status change, and Bulk Task actions),
 * so "Board status change", "Bulk status change", and the existing full
 * form's own `updateTaskAction` can never drift apart on completedAt/
 * Activity semantics (read-only audit §24's own explicit requirement).
 * `updateTaskAction` itself is intentionally NOT refactored to call
 * these — it already diffs a whole form's worth of fields at once and has
 * its own established, working Activity-splitting logic; these functions
 * exist for the two callers that only ever need to change ONE field.
 *
 * Every function here is independently tenant-scoped
 * (`project: { organizationId }`) and independently transactional — never
 * a shared/batched transaction across multiple Tasks (see bulk-actions.ts's
 * own doc comment for why: a variable-size `$transaction([...])` across N
 * rows is exactly the Leads Pipeline P2028 anti-pattern this app's own
 * established lesson forbids).
 */

export type TaskMutationResult =
  | { ok: true }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "INVALID_VALUE" }
  | { ok: false; reason: "INVALID_ASSIGNEE" };

export async function changeTaskStatus(
  organizationId: string,
  actor: { id: string; name: string },
  taskId: string,
  newStatus: string,
): Promise<TaskMutationResult> {
  if (!TASK_STATUSES.includes(newStatus as TaskStatusValue)) {
    return { ok: false, reason: "INVALID_VALUE" };
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.task.findFirst({
      where: { id: taskId, project: { organizationId } },
      include: { project: { select: { name: true } } },
    });
    if (!existing) {
      return { ok: false, reason: "NOT_FOUND" };
    }
    if (existing.status === newStatus) {
      // A genuine no-op (e.g. dropping a Board card back onto its own
      // column) — never writes an empty/no-change Activity row, matching
      // updateTaskAction's own "a pure resubmit creates no Activity"
      // discipline.
      return { ok: true };
    }

    await tx.task.update({
      where: { id: taskId },
      data: {
        status: newStatus as TaskStatusValue,
        completedAt: deriveCompletedAt(newStatus as TaskStatusValue, existing.completedAt),
      },
    });

    await createActivity(tx, {
      organizationId,
      actorId: actor.id,
      entityType: "TASK",
      entityId: taskId,
      action: "STATUS_CHANGED",
      metadata: buildTaskStatusChangedMetadata(existing, existing.project.name, existing.status, newStatus, actor.name),
    });

    return { ok: true };
  });
}

export async function changeTaskAssignee(
  organizationId: string,
  actor: { id: string; name: string },
  taskId: string,
  assigneeId: string | null,
): Promise<TaskMutationResult> {
  if (assigneeId) {
    const membership = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId: assigneeId, organizationId } },
      select: { userId: true },
    });
    if (!membership) {
      return { ok: false, reason: "INVALID_ASSIGNEE" };
    }
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.task.findFirst({
      where: { id: taskId, project: { organizationId } },
      include: { project: { select: { name: true } } },
    });
    if (!existing) {
      return { ok: false, reason: "NOT_FOUND" };
    }
    if (existing.assigneeId === assigneeId) {
      return { ok: true };
    }

    await tx.task.update({ where: { id: taskId }, data: { assigneeId } });

    await createActivity(tx, {
      organizationId,
      actorId: actor.id,
      entityType: "TASK",
      entityId: taskId,
      action: "UPDATED",
      metadata: buildTaskUpdatedMetadata(existing, existing.project.name, ["assigneeId"], actor.name),
    });

    return { ok: true };
  });
}

export async function changeTaskPriority(
  organizationId: string,
  actor: { id: string; name: string },
  taskId: string,
  newPriority: string,
): Promise<TaskMutationResult> {
  if (!TASK_PRIORITIES.includes(newPriority as TaskPriorityValue)) {
    return { ok: false, reason: "INVALID_VALUE" };
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.task.findFirst({
      where: { id: taskId, project: { organizationId } },
      include: { project: { select: { name: true } } },
    });
    if (!existing) {
      return { ok: false, reason: "NOT_FOUND" };
    }
    if (existing.priority === newPriority) {
      return { ok: true };
    }

    await tx.task.update({ where: { id: taskId }, data: { priority: newPriority as TaskPriorityValue } });

    await createActivity(tx, {
      organizationId,
      actorId: actor.id,
      entityType: "TASK",
      entityId: taskId,
      action: "UPDATED",
      metadata: buildTaskUpdatedMetadata(
        { ...existing, priority: newPriority },
        existing.project.name,
        ["priority"],
        actor.name,
      ),
    });

    return { ok: true };
  });
}
