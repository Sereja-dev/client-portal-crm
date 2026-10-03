import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  fetchProjectHealth,
  fetchProjectTasks,
  fetchProjectTimeEntries,
  fetchProjectInvoices,
  fetchProjectContracts,
  PROJECT_TAB_ROW_BOUND,
} from "@/app/(dashboard)/projects/[id]/profile-query";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Project Hub V1 — the bounded, tenant-scoped query layer behind the
 * Hub's Overview health strip and each relationship tab. Mirrors Client
 * Profile Hub's own `profile-query.test.ts` exactly: tests the query
 * functions directly, never the page.tsx Server Component itself.
 */

const PREFIX = "ProjectHub-Query";
const NOW = new Date("2026-06-15T12:00:00.000Z");

function uniqueName(): string {
  return `${PREFIX}-${randomUUID().slice(0, 8)}`;
}

describe("Project Hub — health signals", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({ where: { invoiceNumber: { startsWith: PREFIX } } });
    await prisma.project.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await cleanupTestData(fixtures);
  });

  async function createProject(organizationId: string, clientId: string, ownerId: string) {
    return prisma.project.create({ data: { name: uniqueName(), organizationId, clientId, ownerId, status: "IN_PROGRESS" } });
  }

  it("open/overdue tasks: scoped to this Project's own projectId, excludes another Project's/org's tasks", async () => {
    const project = await createProject(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id);
    const otherProject = await createProject(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id);

    await prisma.task.createMany({
      data: [
        { title: `${PREFIX}-todo`, projectId: project.id, organizationId: fixtures.orgA.id, status: "TODO" },
        { title: `${PREFIX}-overdue`, projectId: project.id, organizationId: fixtures.orgA.id, status: "TODO", dueDate: new Date("2026-06-01T00:00:00Z") },
        { title: `${PREFIX}-done`, projectId: project.id, organizationId: fixtures.orgA.id, status: "DONE" },
        { title: `${PREFIX}-other-project`, projectId: otherProject.id, organizationId: fixtures.orgA.id, status: "TODO" },
      ],
    });

    const health = await fetchProjectHealth(fixtures.orgA.id, project.id, NOW);
    expect(health.openTaskCount).toBe(2);
    expect(health.overdueTaskCount).toBe(1);
  });

  it("tracked time: sums non-archived TimeEntry.durationMinutes for this Project only, excludes archived and another Project's entries", async () => {
    const project = await createProject(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id);
    const otherProject = await createProject(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id);

    await prisma.timeEntry.createMany({
      data: [
        { organizationId: fixtures.orgA.id, projectId: project.id, userId: fixtures.owner.id, workDate: NOW, durationMinutes: 60 },
        { organizationId: fixtures.orgA.id, projectId: project.id, userId: fixtures.owner.id, workDate: NOW, durationMinutes: 30 },
        { organizationId: fixtures.orgA.id, projectId: project.id, userId: fixtures.owner.id, workDate: NOW, durationMinutes: 999, archivedAt: NOW },
        { organizationId: fixtures.orgA.id, projectId: otherProject.id, userId: fixtures.owner.id, workDate: NOW, durationMinutes: 999 },
      ],
    });

    const health = await fetchProjectHealth(fixtures.orgA.id, project.id, NOW);
    expect(health.trackedMinutes).toBe(90);
  });

  it("invoices: a count only, scoped to this Project, never a cross-currency sum", async () => {
    const project = await createProject(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id);
    const otherProject = await createProject(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id);

    await prisma.invoice.createMany({
      data: [
        { invoiceNumber: `${PREFIX}-inv-1`, organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, projectId: project.id, amount: "10.00", currency: "USD" },
        { invoiceNumber: `${PREFIX}-inv-2`, organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, projectId: project.id, amount: "20.00", currency: "EUR" },
        { invoiceNumber: `${PREFIX}-inv-other`, organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, projectId: otherProject.id, amount: "1.00" },
      ],
    });

    const health = await fetchProjectHealth(fixtures.orgA.id, project.id, NOW);
    expect(health.invoiceCount).toBe(2);
  });

  it("a genuinely empty Project (no Tasks/Time/Invoices) reports all-zero health, never an error", async () => {
    const project = await createProject(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id);
    const health = await fetchProjectHealth(fixtures.orgA.id, project.id, NOW);
    expect(health).toEqual({ openTaskCount: 0, overdueTaskCount: 0, trackedMinutes: 0, invoiceCount: 0 });
  });

  // Work Hub Production defect (read-only root-cause audit): Task.
  // organizationId is a nullable column added by migration
  // 20260731055411_add_multi_tenant_schema with no backfill UPDATE, so
  // every Task created before that migration permanently has it NULL —
  // unlike Invoice.organizationId (required, explicitly backfilled) or
  // TimeEntry.organizationId (required from the start). fetchProjectHealth
  // and fetchProjectTasks must still find/count such a Task correctly,
  // scoped through the required Project relation rather than this
  // unreliable column — reproduced here with the exact minimal shape the
  // audit proved: organizationId explicitly null, projectId valid.
  it("historical compatibility: a Task with organizationId = null (pre-multi-tenant-migration shape) is still visible and counted via the Project relation", async () => {
    const project = await createProject(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id);

    await prisma.task.createMany({
      data: [
        { title: `${PREFIX}-historical-open`, projectId: project.id, organizationId: null, status: "TODO" },
        {
          title: `${PREFIX}-historical-overdue`,
          projectId: project.id,
          organizationId: null,
          status: "TODO",
          dueDate: new Date("2026-06-01T00:00:00Z"),
        },
      ],
    });

    const health = await fetchProjectHealth(fixtures.orgA.id, project.id, NOW);
    expect(health.openTaskCount).toBe(2);
    expect(health.overdueTaskCount).toBe(1);

    const rows = await fetchProjectTasks(fixtures.orgA.id, project.id);
    expect(rows.map((r) => r.title).sort()).toEqual(
      [`${PREFIX}-historical-open`, `${PREFIX}-historical-overdue`].sort(),
    );
  });
});

describe("Project Hub — relationship tab query isolation", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterAll(async () => {
    await prisma.contract.deleteMany({ where: { contractNumber: { startsWith: PREFIX } } });
    await prisma.invoice.deleteMany({ where: { invoiceNumber: { startsWith: PREFIX } } });
    await prisma.project.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await cleanupTestData(fixtures);
  });

  async function createProject(organizationId: string, clientId: string, ownerId: string) {
    return prisma.project.create({ data: { name: uniqueName(), organizationId, clientId, ownerId, status: "IN_PROGRESS" } });
  }

  /** Documents Slice A — raw prisma.contract.create, matching this file's own existing direct-Prisma-create convention (prisma.invoice.createMany above) rather than going through the Contract domain service, which has its own dedicated test suite (test/integration/contracts/). */
  async function createContract(organizationId: string, clientId: string, projectId: string | null, createdByUserId: string, suffix: string) {
    return prisma.contract.create({
      data: {
        organizationId,
        clientId,
        projectId,
        createdByUserId,
        contractNumber: `${PREFIX}-${suffix}`,
        title: `${PREFIX} contract ${suffix}`,
        body: "This agreement is entered into by and between the parties as of the issue date below.",
      },
    });
  }

  it("Tasks: bounded, scoped to this Project, includes assignee", async () => {
    const project = await createProject(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id);
    const otherProject = await createProject(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id);

    await prisma.task.createMany({
      data: Array.from({ length: PROJECT_TAB_ROW_BOUND + 5 }, (_, i) => ({
        title: `${PREFIX}-t-${i}`,
        projectId: project.id,
        organizationId: fixtures.orgA.id,
        assigneeId: i === 0 ? fixtures.owner.id : null,
      })),
    });
    await prisma.task.create({ data: { title: `${PREFIX}-other-project`, projectId: otherProject.id, organizationId: fixtures.orgA.id } });

    const rows = await fetchProjectTasks(fixtures.orgA.id, project.id);
    expect(rows).toHaveLength(PROJECT_TAB_ROW_BOUND);
    expect(rows.every((r) => r.title.startsWith(`${PREFIX}-t-`))).toBe(true);
    expect(rows.some((r) => r.assignee?.id === fixtures.owner.id)).toBe(true);
  });

  it("Time: bounded, scoped to this Project, excludes archived entries, includes task/user/billable", async () => {
    const project = await createProject(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id);
    const task = await prisma.task.create({ data: { title: uniqueName(), projectId: project.id, organizationId: fixtures.orgA.id } });

    await prisma.timeEntry.create({
      data: {
        organizationId: fixtures.orgA.id,
        projectId: project.id,
        taskId: task.id,
        userId: fixtures.owner.id,
        workDate: NOW,
        durationMinutes: 45,
        billable: false,
        description: `${PREFIX}-entry`,
      },
    });
    await prisma.timeEntry.create({
      data: { organizationId: fixtures.orgA.id, projectId: project.id, userId: fixtures.owner.id, workDate: NOW, durationMinutes: 10, archivedAt: NOW },
    });

    const rows = await fetchProjectTimeEntries(fixtures.orgA.id, project.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.task?.id).toBe(task.id);
    expect(rows[0]?.user?.id).toBe(fixtures.owner.id);
    expect(rows[0]?.billable).toBe(false);
  });

  it("Invoices: bounded, scoped to this Project, each row keeps its own currency (never summed)", async () => {
    const project = await createProject(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id);

    await prisma.invoice.createMany({
      data: [
        { invoiceNumber: `${PREFIX}-inv-a`, organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, projectId: project.id, amount: "5.00", currency: "USD" },
        { invoiceNumber: `${PREFIX}-inv-b`, organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, projectId: project.id, amount: "7.00", currency: "GBP" },
      ],
    });

    const rows = await fetchProjectInvoices(fixtures.orgA.id, project.id);
    expect(rows.map((r) => r.invoiceNumber).sort()).toEqual([`${PREFIX}-inv-a`, `${PREFIX}-inv-b`]);
    const byNumber = new Map(rows.map((r) => [r.invoiceNumber, r]));
    expect(byNumber.get(`${PREFIX}-inv-a`)?.currency).toBe("USD");
    expect(byNumber.get(`${PREFIX}-inv-b`)?.currency).toBe("GBP");
  });

  it("foreign-org Project id: every tab-fetch function returns nothing when scoped by the wrong organizationId", async () => {
    const project = await createProject(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id);
    await prisma.task.create({ data: { title: uniqueName(), projectId: project.id, organizationId: fixtures.orgA.id } });

    const tasksFromWrongOrg = await fetchProjectTasks(fixtures.orgB.id, project.id);
    const timeFromWrongOrg = await fetchProjectTimeEntries(fixtures.orgB.id, project.id);
    const invoicesFromWrongOrg = await fetchProjectInvoices(fixtures.orgB.id, project.id);
    const contractsFromWrongOrg = await fetchProjectContracts(fixtures.orgB.id, project.id);
    const healthFromWrongOrg = await fetchProjectHealth(fixtures.orgB.id, project.id, NOW);

    expect(tasksFromWrongOrg).toEqual([]);
    expect(timeFromWrongOrg).toEqual([]);
    expect(invoicesFromWrongOrg).toEqual([]);
    expect(contractsFromWrongOrg).toEqual([]);
    expect(healthFromWrongOrg).toEqual({ openTaskCount: 0, overdueTaskCount: 0, trackedMinutes: 0, invoiceCount: 0 });
  });

  // Documents Slice A.
  it("Contracts: bounded, scoped to this Project only, excludes another Project's and another org's Contracts, includes signatory", async () => {
    const project = await createProject(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id);
    const otherProject = await createProject(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id);
    const foreignProject = await prisma.project.create({
      data: { name: uniqueName(), organizationId: fixtures.orgB.id, clientId: fixtures.clientB.id, ownerId: fixtures.orgBOwner.id, status: "IN_PROGRESS" },
    });

    const signatory = await prisma.clientContact.create({
      data: { organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, name: `${PREFIX}-signatory` },
    });

    await createContract(fixtures.orgA.id, fixtures.clientA.id, project.id, fixtures.owner.id, "mine-1");
    const signed = await prisma.contract.create({
      data: {
        organizationId: fixtures.orgA.id,
        clientId: fixtures.clientA.id,
        projectId: project.id,
        createdByUserId: fixtures.owner.id,
        contractNumber: `${PREFIX}-mine-2`,
        title: `${PREFIX} contract mine-2`,
        body: "Body.",
        signatoryContactId: signatory.id,
      },
    });
    await createContract(fixtures.orgA.id, fixtures.clientA.id, otherProject.id, fixtures.owner.id, "other-project");
    await createContract(fixtures.orgB.id, fixtures.clientB.id, foreignProject.id, fixtures.orgBOwner.id, "foreign-org");

    const rows = await fetchProjectContracts(fixtures.orgA.id, project.id);
    expect(rows.map((r) => r.contractNumber).sort()).toEqual([`${PREFIX}-mine-1`, `${PREFIX}-mine-2`].sort());
    const bySignatory = rows.find((r) => r.id === signed.id);
    expect(bySignatory?.signatoryContact?.id).toBe(signatory.id);

    await prisma.clientContact.deleteMany({ where: { id: signatory.id } });
  });

  it("Contracts: bounded, same PROJECT_TAB_ROW_BOUND limit as every other tab query", async () => {
    const project = await createProject(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id);
    await prisma.contract.createMany({
      data: Array.from({ length: PROJECT_TAB_ROW_BOUND + 5 }, (_, i) => ({
        organizationId: fixtures.orgA.id,
        clientId: fixtures.clientA.id,
        projectId: project.id,
        createdByUserId: fixtures.owner.id,
        contractNumber: `${PREFIX}-bound-${i}`,
        title: `${PREFIX} bound ${i}`,
        body: "Body.",
      })),
    });

    const rows = await fetchProjectContracts(fixtures.orgA.id, project.id);
    expect(rows).toHaveLength(PROJECT_TAB_ROW_BOUND);
  });

  it("Contracts: a genuinely contract-less Project returns an empty array, never an error", async () => {
    const project = await createProject(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id);
    const rows = await fetchProjectContracts(fixtures.orgA.id, project.id);
    expect(rows).toEqual([]);
  });

  // Tenant-isolation regression for the relation-based scoping above:
  // dropping the direct Task.organizationId equality filter must not
  // accidentally widen visibility. A foreign-org Task — in the same
  // historical organizationId-null shape — linked to a DIFFERENT
  // Project in a DIFFERENT Organization must never appear in this
  // Project's own reads, proving tenancy is still enforced through the
  // Project relation, not merely no-longer-enforced at all.
  it("a foreign-org Task (also organizationId = null) linked to a different org's Project never leaks into this Project's own reads", async () => {
    const project = await createProject(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id);
    const foreignProject = await prisma.project.create({
      data: {
        name: uniqueName(),
        organizationId: fixtures.orgB.id,
        clientId: fixtures.clientB.id,
        ownerId: fixtures.orgBOwner.id,
        status: "IN_PROGRESS",
      },
    });
    await prisma.task.create({
      data: { title: `${PREFIX}-foreign-null-org`, projectId: foreignProject.id, organizationId: null, status: "TODO" },
    });

    const rows = await fetchProjectTasks(fixtures.orgA.id, project.id);
    expect(rows).toEqual([]);

    const health = await fetchProjectHealth(fixtures.orgA.id, project.id, NOW);
    expect(health.openTaskCount).toBe(0);
  });
});
