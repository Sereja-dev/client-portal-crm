import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { buildProjectWhere, parseProjectListParams } from "@/app/(dashboard)/projects/query";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Stale custom-status filter hardening — the Projects list page's own
 * query-building layer (src/app/(dashboard)/projects/query.ts), tested
 * directly against the real database. Mirrors test/integration/clients/
 * list-query.test.ts's own identical shape/conventions for the sibling
 * domain — no prior dedicated test file existed for this module either.
 */

const NAME_PREFIX = "Project-ListQuery";

function uniqueName(): string {
  return `${NAME_PREFIX}-${randomUUID().slice(0, 8)}`;
}

describe("Projects list query (org scoping, status filter, safety)", () => {
  let fixtures: TestFixtures;
  let inProgressDefinitionId: string;
  let projectInProgress: string;
  let projectOther: string;
  let projectForeignOrg: string;

  beforeAll(async () => {
    fixtures = await seedTestData();

    // seedTestData() does not run bootstrap.ts's own CustomStatusDefinition
    // seeding — see clients/list-query.test.ts's own identical comment.
    const inProgressDefinition = await prisma.customStatusDefinition.create({
      data: {
        organizationId: fixtures.orgA.id,
        entityType: "PROJECT",
        key: "in_progress",
        label: "In Progress",
        position: 1,
        isSystem: true,
      },
    });
    inProgressDefinitionId = inProgressDefinition.id;

    const foreignClient = await prisma.client.create({
      data: { name: uniqueName(), organizationId: fixtures.orgB.id, userId: fixtures.orgBOwner.id },
    });

    const [a, other, foreign] = await Promise.all([
      prisma.project.create({
        data: {
          name: uniqueName(),
          clientId: fixtures.clientA.id,
          ownerId: fixtures.owner.id,
          organizationId: fixtures.orgA.id,
          status: "IN_PROGRESS",
        },
      }),
      prisma.project.create({
        data: {
          name: uniqueName(),
          clientId: fixtures.clientA.id,
          ownerId: fixtures.owner.id,
          organizationId: fixtures.orgA.id,
          status: "PLANNING",
        },
      }),
      prisma.project.create({
        data: {
          name: uniqueName(),
          clientId: foreignClient.id,
          ownerId: fixtures.orgBOwner.id,
          organizationId: fixtures.orgB.id,
        },
      }),
    ]);
    projectInProgress = a.id;
    projectOther = other.id;
    projectForeignOrg = foreign.id;
  });

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { name: { startsWith: NAME_PREFIX } } });
    await prisma.client.deleteMany({ where: { name: { startsWith: NAME_PREFIX } } });
    await prisma.customStatusDefinition.delete({ where: { id: inProgressDefinitionId } });
    await cleanupTestData(fixtures);
  });

  it("only returns projects scoped to the caller's own organization", async () => {
    const where = await buildProjectWhere(fixtures.orgA.id, parseProjectListParams({}));
    const results = await prisma.project.findMany({ where });
    const ids = results.map((r) => r.id);
    expect(ids).toContain(projectInProgress);
    expect(ids).not.toContain(projectForeignOrg);
  });

  it("a valid, resolvable status key narrows correctly", async () => {
    const where = await buildProjectWhere(fixtures.orgA.id, parseProjectListParams({ status: "in_progress" }));
    const results = await prisma.project.findMany({ where });
    const ids = results.map((r) => r.id);
    expect(ids).toContain(projectInProgress);
    expect(ids).not.toContain(projectOther);
  });

  it("an unresolved status key now fails CLOSED — zero rows, never silently \"no filter\" broadening to all projects", async () => {
    const where = await buildProjectWhere(fixtures.orgA.id, parseProjectListParams({ status: "never-existed-key-xyz" }));
    const results = await prisma.project.findMany({ where });
    expect(results).toHaveLength(0);
  });

  it("a status key that only exists in a DIFFERENT organization resolves to zero rows in this one — never a cross-org leak", async () => {
    const foreignDefinition = await prisma.customStatusDefinition.create({
      data: {
        organizationId: fixtures.orgB.id,
        entityType: "PROJECT",
        key: "foreign-only-project-status",
        label: "Foreign Only Status",
        position: 999,
      },
    });
    try {
      const where = await buildProjectWhere(fixtures.orgA.id, parseProjectListParams({ status: foreignDefinition.key }));
      const results = await prisma.project.findMany({ where });
      expect(results).toHaveLength(0);
    } finally {
      await prisma.customStatusDefinition.delete({ where: { id: foreignDefinition.id } });
    }
  });

  it("a real but ARCHIVED custom status definition remains a valid filter — still narrows correctly, never treated as unresolved", async () => {
    const definition = await prisma.customStatusDefinition.create({
      data: {
        organizationId: fixtures.orgA.id,
        entityType: "PROJECT",
        key: "archived-project-status-for-list-query-test",
        label: "Archived Project Status",
        position: 998,
        archivedAt: new Date(),
      },
    });
    const taggedProject = await prisma.project.create({
      data: {
        name: uniqueName(),
        clientId: fixtures.clientA.id,
        ownerId: fixtures.owner.id,
        organizationId: fixtures.orgA.id,
        statusDefinitionId: definition.id,
      },
    });
    try {
      const where = await buildProjectWhere(fixtures.orgA.id, parseProjectListParams({ status: definition.key }));
      const results = await prisma.project.findMany({ where });
      const ids = results.map((r) => r.id);
      expect(ids).toContain(taggedProject.id);
      expect(ids).not.toContain(projectInProgress);
    } finally {
      await prisma.project.delete({ where: { id: taggedProject.id } });
      await prisma.customStatusDefinition.delete({ where: { id: definition.id } });
    }
  });

  it("search still composes correctly alongside the status filter (existing AND structure preserved)", async () => {
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectInProgress } });
    const where = await buildProjectWhere(fixtures.orgA.id, parseProjectListParams({ status: "in_progress", q: project.name }));
    const results = await prisma.project.findMany({ where });
    expect(results.map((r) => r.id)).toContain(projectInProgress);
  });
});
