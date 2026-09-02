import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../../fixtures/seed";
import { executeSearchTasks } from "@/lib/ai/tools/tasks";

describe("executeSearchTasks — integration", () => {
  let fixtures: TestFixtures;
  let sensitiveTaskId: string;
  /** Task.organizationId misleadingly null, even though its real Project belongs to orgA — must still be found via project.organizationId. */
  let nullOrgIdTaskId: string;
  /** Task.organizationId misleadingly set to orgA, even though its real Project belongs to orgB — must NEVER be found when searching orgA. */
  let misleadingOrgIdTaskId: string;

  beforeAll(async () => {
    fixtures = await seedTestData();

    const sensitive = await prisma.task.create({
      data: {
        title: "Sensitive Task",
        projectId: fixtures.project.id,
        organizationId: fixtures.orgA.id,
        status: "TODO",
        priority: "HIGH",
        description: "CONFIDENTIAL: do not discuss with the client directly.",
      },
    });
    sensitiveTaskId = sensitive.id;

    // Deliberately bypass the normal create-with-organizationId convention
    // (a real write path always sets it) to reproduce the exact schema-
    // permitted "misleading/null Task.organizationId" state this test
    // exists to guard against.
    const nullOrgTask = await prisma.task.create({
      data: { title: "Null OrgId Task", projectId: fixtures.project.id, status: "TODO", priority: "MEDIUM" },
    });
    await prisma.task.update({ where: { id: nullOrgTask.id }, data: { organizationId: null } });
    nullOrgIdTaskId = nullOrgTask.id;

    const otherOrgClient = await prisma.client.create({
      data: { name: "Cross-Org Probe Client", organizationId: fixtures.orgB.id, userId: fixtures.orgBOwner.id },
    });
    const otherOrgProject = await prisma.project.create({
      data: { name: "Cross-Org Probe Project", clientId: otherOrgClient.id, organizationId: fixtures.orgB.id, ownerId: fixtures.orgBOwner.id },
    });
    const misleadingTask = await prisma.task.create({
      data: { title: "Misleading OrgId Task", projectId: otherOrgProject.id, organizationId: fixtures.orgB.id, status: "TODO", priority: "LOW" },
    });
    // Force Task.organizationId to (misleadingly) point at orgA, while its
    // real Project (and thus real ownership) stays with orgB.
    await prisma.task.update({ where: { id: misleadingTask.id }, data: { organizationId: fixtures.orgA.id } });
    misleadingOrgIdTaskId = misleadingTask.id;
  });

  afterAll(async () => {
    await prisma.task.deleteMany({ where: { id: { in: [sensitiveTaskId, nullOrgIdTaskId, misleadingOrgIdTaskId] } } });
    await prisma.project.deleteMany({ where: { name: "Cross-Org Probe Project" } });
    await prisma.client.deleteMany({ where: { name: "Cross-Org Probe Client" } });
    await cleanupTestData(fixtures);
  });

  it("returns only the caller's own-org tasks (via project.organizationId)", async () => {
    const result = await executeSearchTasks(fixtures.orgA.id, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.results.map((r) => r.ref)).toContain(fixtures.task.id);
  });

  it("CRITICAL: a task with Task.organizationId misleadingly NULL is still found, because project.organizationId is the authoritative boundary", async () => {
    const result = await executeSearchTasks(fixtures.orgA.id, { query: "Null OrgId Task" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.results.map((r) => r.ref)).toContain(nullOrgIdTaskId);
  });

  it("CRITICAL: a task whose Task.organizationId misleadingly points at orgA, but whose real Project belongs to orgB, is NEVER returned to orgA", async () => {
    const result = await executeSearchTasks(fixtures.orgA.id, { query: "Misleading OrgId Task" });
    expect(result).toEqual({ ok: true, results: [] });
  });

  it("no-match returns an empty array, never an error", async () => {
    const result = await executeSearchTasks(fixtures.orgA.id, { query: "zzz-no-such-task-zzz" });
    expect(result).toEqual({ ok: true, results: [] });
  });

  it("filters by status/priority/dueBefore", async () => {
    const byStatus = await executeSearchTasks(fixtures.orgA.id, { status: "TODO" });
    expect(byStatus.ok).toBe(true);
    const byPriority = await executeSearchTasks(fixtures.orgA.id, { priority: "HIGH" });
    expect(byPriority.ok).toBe(true);
    if (byPriority.ok) {
      expect(byPriority.results.some((r) => r.ref === sensitiveTaskId)).toBe(true);
    }
  });

  it("returns exactly the approved 6 fields — description/assignee never survive projection", async () => {
    const result = await executeSearchTasks(fixtures.orgA.id, { query: "Sensitive Task" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const hit = result.results.find((r) => r.ref === sensitiveTaskId);
    expect(hit).toBeDefined();
    expect(Object.keys(hit!).sort()).toEqual(["ref", "title", "status", "priority", "dueDate", "projectName"].sort());
    const serialized = JSON.stringify(hit);
    expect(serialized).not.toMatch(/CONFIDENTIAL/);
    expect(serialized).not.toMatch(/do not discuss/i);
  });

  it("respects the fixed cap of 15", async () => {
    const extraIds: string[] = [];
    try {
      for (let i = 0; i < 17; i++) {
        const t = await prisma.task.create({
          data: { title: `Cap Test Task ${i}`, projectId: fixtures.project.id, organizationId: fixtures.orgA.id, status: "TODO", priority: "LOW" },
        });
        extraIds.push(t.id);
      }
      const result = await executeSearchTasks(fixtures.orgA.id, { query: "Cap Test Task" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.results.length).toBe(15);
    } finally {
      await prisma.task.deleteMany({ where: { id: { in: extraIds } } });
    }
  });

  it("orders tasks with a due date before tasks with none (nulls last), and is deterministic across repeated calls", async () => {
    const first = await executeSearchTasks(fixtures.orgA.id, { query: "Sensitive Task" });
    const second = await executeSearchTasks(fixtures.orgA.id, { query: "Sensitive Task" });
    expect(first).toEqual(second);
  });
});
