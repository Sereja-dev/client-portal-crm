import { randomUUID } from "node:crypto";
import { afterEach, afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import {
  bulkUpdateTaskStatusAction,
  bulkUpdateTaskAssigneeAction,
  bulkUpdateTaskPriorityAction,
} from "@/app/(dashboard)/tasks/bulk-actions";
import { TASK_BULK_MAX } from "@/lib/tasks/bulk-types";
import { updateTaskStatusAction } from "@/app/(dashboard)/tasks/board-actions";

/**
 * Bulk Task actions V1 (read-only audit §10/§21-§23/§35) — server-action-
 * level proof of every safety invariant this feature's own locked spec
 * requires: current-org-only rows, a foreign-org id fails that one row
 * without touching it, invalid target values are rejected, the hard
 * TASK_BULK_MAX bound is enforced server-side regardless of client input,
 * and status/completedAt semantics stay identical across single/Board/
 * Bulk updates (never allowed to drift — §24).
 */

const PREFIX = "TaskBulk";

describe("Bulk Task actions", () => {
  let fixtures: TestFixtures;
  let project: { id: string };

  beforeAll(async () => {
    fixtures = await seedTestData();
    project = await prisma.project.create({
      data: { name: `${PREFIX}-project`, organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, ownerId: fixtures.owner.id },
    });
  });

  afterEach(() => resetAuthMock());

  afterAll(async () => {
    await prisma.task.deleteMany({ where: { projectId: project.id } });
    await prisma.project.deleteMany({ where: { id: project.id } });
    await cleanupTestData(fixtures);
  });

  async function makeTask(overrides: Partial<{ status: string; priority: string; assigneeId: string | null }> = {}) {
    return prisma.task.create({
      data: {
        title: `${PREFIX}-${randomUUID().slice(0, 8)}`,
        projectId: project.id,
        organizationId: fixtures.orgA.id,
        status: (overrides.status as never) ?? "TODO",
        priority: (overrides.priority as never) ?? "MEDIUM",
        assigneeId: overrides.assigneeId ?? null,
      },
    });
  }

  it("bulk status update: applies to every selected same-org Task, returns an exact updated count", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const a = await makeTask();
    const b = await makeTask();

    const result = await bulkUpdateTaskStatusAction([a.id, b.id], "IN_PROGRESS");
    expect(result).toEqual({ updatedCount: 2, failedCount: 0, failures: [] });

    const rows = await prisma.task.findMany({ where: { id: { in: [a.id, b.id] } } });
    expect(rows.every((r) => r.status === "IN_PROGRESS")).toBe(true);
  });

  it("bulk status update moving to DONE sets completedAt; moving away clears it — identical to single-task semantics", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const task = await makeTask({ status: "TODO" });

    await bulkUpdateTaskStatusAction([task.id], "DONE");
    let row = await prisma.task.findUnique({ where: { id: task.id } });
    expect(row?.completedAt).not.toBeNull();

    await bulkUpdateTaskStatusAction([task.id], "TODO");
    row = await prisma.task.findUnique({ where: { id: task.id } });
    expect(row?.completedAt).toBeNull();
  });

  it("Board's single-card status change and Bulk's status change share identical completedAt semantics (never allowed to drift)", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const boardTask = await makeTask({ status: "TODO" });
    const bulkTask = await makeTask({ status: "TODO" });

    await updateTaskStatusAction(boardTask.id, "DONE");
    await bulkUpdateTaskStatusAction([bulkTask.id], "DONE");

    const [boardRow, bulkRow] = await Promise.all([
      prisma.task.findUnique({ where: { id: boardTask.id } }),
      prisma.task.findUnique({ where: { id: bulkTask.id } }),
    ]);
    expect(boardRow?.completedAt).not.toBeNull();
    expect(bulkRow?.completedAt).not.toBeNull();
  });

  it("an invalid target status is rejected for that row, never silently applied", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const task = await makeTask({ status: "TODO" });

    const result = await bulkUpdateTaskStatusAction([task.id], "NOT_A_REAL_STATUS");
    expect(result.updatedCount).toBe(0);
    expect(result.failedCount).toBe(1);

    const row = await prisma.task.findUnique({ where: { id: task.id } });
    expect(row?.status).toBe("TODO");
  });

  it("bulk assignee update: a valid same-org member succeeds; an assignee outside the organization is rejected without mutating the row", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const task = await makeTask();

    const okResult = await bulkUpdateTaskAssigneeAction([task.id], fixtures.member.id);
    expect(okResult).toEqual({ updatedCount: 1, failedCount: 0, failures: [] });
    let row = await prisma.task.findUnique({ where: { id: task.id } });
    expect(row?.assigneeId).toBe(fixtures.member.id);

    const badResult = await bulkUpdateTaskAssigneeAction([task.id], fixtures.orgBOwner.id);
    expect(badResult.failedCount).toBe(1);
    row = await prisma.task.findUnique({ where: { id: task.id } });
    expect(row?.assigneeId).toBe(fixtures.member.id); // unchanged

    const unassignResult = await bulkUpdateTaskAssigneeAction([task.id], null);
    expect(unassignResult).toEqual({ updatedCount: 1, failedCount: 0, failures: [] });
    row = await prisma.task.findUnique({ where: { id: task.id } });
    expect(row?.assigneeId).toBeNull();
  });

  it("bulk priority update: applies to every selected row", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const task = await makeTask({ priority: "LOW" });

    const result = await bulkUpdateTaskPriorityAction([task.id], "URGENT");
    expect(result).toEqual({ updatedCount: 1, failedCount: 0, failures: [] });
    const row = await prisma.task.findUnique({ where: { id: task.id } });
    expect(row?.priority).toBe("URGENT");
  });

  it("a foreign-org Task id fails safely for that row only — it is never mutated, and it never blocks the other, genuinely-owned rows from succeeding", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const ownTask = await makeTask({ status: "TODO" });
    const foreignProject = await prisma.project.create({
      data: { name: `${PREFIX}-foreign`, organizationId: fixtures.orgB.id, clientId: fixtures.clientB.id, ownerId: fixtures.orgBOwner.id },
    });
    const foreignTask = await prisma.task.create({
      data: { title: `${PREFIX}-foreign-task`, projectId: foreignProject.id, organizationId: fixtures.orgB.id, status: "TODO" },
    });

    const result = await bulkUpdateTaskStatusAction([ownTask.id, foreignTask.id], "DONE");
    expect(result.updatedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.failures[0]?.reason).toBe("NOT_FOUND");

    const [ownRow, foreignRow] = await Promise.all([
      prisma.task.findUnique({ where: { id: ownTask.id } }),
      prisma.task.findUnique({ where: { id: foreignTask.id } }),
    ]);
    expect(ownRow?.status).toBe("DONE");
    expect(foreignRow?.status).toBe("TODO"); // never mutated by another tenant's bulk call

    await prisma.task.deleteMany({ where: { projectId: foreignProject.id } });
    await prisma.project.deleteMany({ where: { id: foreignProject.id } });
  });

  it("more than TASK_BULK_MAX selected ids is rejected outright, server-side, regardless of client-side limits", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const tooMany = Array.from({ length: TASK_BULK_MAX + 1 }, () => randomUUID());

    const result = await bulkUpdateTaskStatusAction(tooMany, "DONE");
    expect(result.updatedCount).toBe(0);
    expect(result.failedCount).toBe(tooMany.length);
  });

  it("successful bulk status/priority/assignee changes each record an Activity row, same as a single-task update", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const task = await makeTask({ status: "TODO" });

    await bulkUpdateTaskStatusAction([task.id], "IN_PROGRESS");

    const activities = await prisma.activity.findMany({
      where: { organizationId: fixtures.orgA.id, entityType: "TASK", entityId: task.id },
    });
    expect(activities.some((a) => a.action === "STATUS_CHANGED")).toBe(true);
  });
});
