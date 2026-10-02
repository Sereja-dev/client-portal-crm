import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { fetchTaskBoardColumns, TASK_BOARD_COLUMN_BOUND } from "@/app/(dashboard)/tasks/board-query";
import { parseTaskListParams } from "@/app/(dashboard)/tasks/query";
import { TASK_STATUSES } from "@/lib/validation/task";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Task Board V1 (read-only audit §7/§19/§33) — the Board's own query
 * layer: exactly one column per TaskStatus, each independently bounded
 * and exactly counted, tenant-scoped, and respecting every List-view
 * filter identically (never a second, parallel filter implementation).
 */

const PREFIX = "TaskBoard-Query";
const NOW = new Date("2026-06-15T12:00:00.000Z");

describe("fetchTaskBoardColumns", () => {
  let fixtures: TestFixtures;
  let project: { id: string };

  beforeAll(async () => {
    fixtures = await seedTestData();
    project = await prisma.project.create({
      data: { name: `${PREFIX}-project`, organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, ownerId: fixtures.owner.id },
    });
  });

  afterAll(async () => {
    await prisma.task.deleteMany({ where: { projectId: project.id } });
    await prisma.project.deleteMany({ where: { id: project.id } });
    await cleanupTestData(fixtures);
  });

  it("returns exactly one column per TaskStatus, in TASK_STATUSES order", async () => {
    const params = parseTaskListParams({});
    const columns = await fetchTaskBoardColumns(fixtures.orgA.id, params, NOW);
    expect(columns.map((c) => c.status)).toEqual([...TASK_STATUSES]);
  });

  it("groups cards by status correctly and excludes another org's Task", async () => {
    const foreignProject = await prisma.project.create({
      data: { name: `${PREFIX}-foreign`, organizationId: fixtures.orgB.id, clientId: fixtures.clientB.id, ownerId: fixtures.orgBOwner.id },
    });
    await prisma.task.createMany({
      data: [
        { title: `${PREFIX}-todo`, projectId: project.id, organizationId: fixtures.orgA.id, status: "TODO" },
        { title: `${PREFIX}-done`, projectId: project.id, organizationId: fixtures.orgA.id, status: "DONE" },
      ],
    });
    await prisma.task.create({
      data: { title: `${PREFIX}-foreign-todo`, projectId: foreignProject.id, organizationId: fixtures.orgB.id, status: "TODO" },
    });

    const params = parseTaskListParams({});
    const columns = await fetchTaskBoardColumns(fixtures.orgA.id, params, NOW);
    const todoColumn = columns.find((c) => c.status === "TODO")!;
    const doneColumn = columns.find((c) => c.status === "DONE")!;

    expect(todoColumn.cards.some((c) => c.title === `${PREFIX}-todo`)).toBe(true);
    expect(todoColumn.cards.some((c) => c.title === `${PREFIX}-foreign-todo`)).toBe(false);
    expect(doneColumn.cards.some((c) => c.title === `${PREFIX}-done`)).toBe(true);

    await prisma.task.deleteMany({ where: { projectId: foreignProject.id } });
    await prisma.project.deleteMany({ where: { id: foreignProject.id } });
  });

  it("a column exceeding the bound is truncated with an exact, truthful count — never silently pretending completeness", async () => {
    const bigProject = await prisma.project.create({
      data: { name: `${PREFIX}-big`, organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, ownerId: fixtures.owner.id },
    });
    await prisma.task.createMany({
      data: Array.from({ length: TASK_BOARD_COLUMN_BOUND + 5 }, (_, i) => ({
        title: `${PREFIX}-bound-${i}`,
        projectId: bigProject.id,
        organizationId: fixtures.orgA.id,
        status: "IN_REVIEW" as const,
      })),
    });

    const params = parseTaskListParams({});
    const columns = await fetchTaskBoardColumns(fixtures.orgA.id, params, NOW);
    const column = columns.find((c) => c.status === "IN_REVIEW")!;

    expect(column.cards).toHaveLength(TASK_BOARD_COLUMN_BOUND);
    expect(column.total).toBe(TASK_BOARD_COLUMN_BOUND + 5);
    expect(column.truncated).toBe(true);

    await prisma.task.deleteMany({ where: { projectId: bigProject.id } });
    await prisma.project.deleteMany({ where: { id: bigProject.id } });
  });

  it("respects an active filter (priority=HIGH) identically to the List view — never a second, parallel filter implementation", async () => {
    await prisma.task.createMany({
      data: [
        { title: `${PREFIX}-high`, projectId: project.id, organizationId: fixtures.orgA.id, status: "TODO", priority: "HIGH" },
        { title: `${PREFIX}-low`, projectId: project.id, organizationId: fixtures.orgA.id, status: "TODO", priority: "LOW" },
      ],
    });

    const params = parseTaskListParams({ priority: "HIGH" });
    const columns = await fetchTaskBoardColumns(fixtures.orgA.id, params, NOW);
    const todoColumn = columns.find((c) => c.status === "TODO")!;
    expect(todoColumn.cards.some((c) => c.title === `${PREFIX}-high`)).toBe(true);
    expect(todoColumn.cards.some((c) => c.title === `${PREFIX}-low`)).toBe(false);
  });
});
