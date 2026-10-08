import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { buildClientWhere, parseClientListParams } from "@/app/(dashboard)/clients/query";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Stale custom-status filter hardening — the Clients list page's own
 * query-building layer (src/app/(dashboard)/clients/query.ts), tested
 * directly against the real database. No prior dedicated test file
 * existed for this module (confirmed during the read-only audit); this
 * one exists specifically to prove the fail-closed repair to
 * `buildClientWhere`'s own unresolved-status branch, mirroring
 * test/integration/leads/list-query.test.ts's own identical shape and
 * conventions for the sibling domain.
 */

const NAME_PREFIX = "Client-ListQuery";

function uniqueName(): string {
  return `${NAME_PREFIX}-${randomUUID().slice(0, 8)}`;
}

describe("Clients list query (org scoping, status filter, safety)", () => {
  let fixtures: TestFixtures;
  let activeDefinitionId: string;
  let clientActive: string;
  let clientOther: string;
  let clientForeignOrg: string;

  beforeAll(async () => {
    fixtures = await seedTestData();

    // seedTestData() does not run bootstrap.ts's own CustomStatusDefinition
    // seeding — mirrors leads/list-query.test.ts's own identical setup
    // comment on why a real, resolvable definition must be seeded here
    // directly rather than assumed to already exist.
    const activeDefinition = await prisma.customStatusDefinition.create({
      data: {
        organizationId: fixtures.orgA.id,
        entityType: "CLIENT",
        key: "active",
        label: "Active",
        position: 1,
        isSystem: true,
      },
    });
    activeDefinitionId = activeDefinition.id;

    const [a, other, foreign] = await Promise.all([
      prisma.client.create({
        data: { name: uniqueName(), organizationId: fixtures.orgA.id, userId: fixtures.owner.id, status: "ACTIVE" },
      }),
      prisma.client.create({
        data: { name: uniqueName(), organizationId: fixtures.orgA.id, userId: fixtures.owner.id, status: "LEAD" },
      }),
      prisma.client.create({
        data: { name: uniqueName(), organizationId: fixtures.orgB.id, userId: fixtures.orgBOwner.id },
      }),
    ]);
    clientActive = a.id;
    clientOther = other.id;
    clientForeignOrg = foreign.id;
  });

  afterAll(async () => {
    await prisma.client.deleteMany({ where: { name: { startsWith: NAME_PREFIX } } });
    await prisma.customStatusDefinition.delete({ where: { id: activeDefinitionId } });
    await cleanupTestData(fixtures);
  });

  it("only returns clients scoped to the caller's own organization", async () => {
    const where = await buildClientWhere(fixtures.orgA.id, parseClientListParams({}));
    const results = await prisma.client.findMany({ where });
    const ids = results.map((r) => r.id);
    expect(ids).toContain(clientActive);
    expect(ids).not.toContain(clientForeignOrg);
  });

  it("a valid, resolvable status key narrows correctly", async () => {
    const where = await buildClientWhere(fixtures.orgA.id, parseClientListParams({ status: "active" }));
    const results = await prisma.client.findMany({ where });
    const ids = results.map((r) => r.id);
    expect(ids).toContain(clientActive);
    expect(ids).not.toContain(clientOther);
  });

  it("an unresolved status key now fails CLOSED — zero rows, never silently \"no filter\" broadening to all clients", async () => {
    const where = await buildClientWhere(fixtures.orgA.id, parseClientListParams({ status: "never-existed-key-xyz" }));
    const results = await prisma.client.findMany({ where });
    expect(results).toHaveLength(0);
  });

  it("a status key that only exists in a DIFFERENT organization resolves to zero rows in this one — never a cross-org leak", async () => {
    const foreignDefinition = await prisma.customStatusDefinition.create({
      data: {
        organizationId: fixtures.orgB.id,
        entityType: "CLIENT",
        key: "foreign-only-client-status",
        label: "Foreign Only Status",
        position: 999,
      },
    });
    try {
      const where = await buildClientWhere(fixtures.orgA.id, parseClientListParams({ status: foreignDefinition.key }));
      const results = await prisma.client.findMany({ where });
      expect(results).toHaveLength(0);
    } finally {
      await prisma.customStatusDefinition.delete({ where: { id: foreignDefinition.id } });
    }
  });

  it("a real but ARCHIVED custom status definition remains a valid filter — still narrows correctly, never treated as unresolved", async () => {
    const definition = await prisma.customStatusDefinition.create({
      data: {
        organizationId: fixtures.orgA.id,
        entityType: "CLIENT",
        key: "archived-client-status-for-list-query-test",
        label: "Archived Client Status",
        position: 998,
        archivedAt: new Date(),
      },
    });
    const taggedClient = await prisma.client.create({
      data: {
        name: uniqueName(),
        organizationId: fixtures.orgA.id,
        userId: fixtures.owner.id,
        statusDefinitionId: definition.id,
      },
    });
    try {
      const where = await buildClientWhere(fixtures.orgA.id, parseClientListParams({ status: definition.key }));
      const results = await prisma.client.findMany({ where });
      const ids = results.map((r) => r.id);
      expect(ids).toContain(taggedClient.id);
      expect(ids).not.toContain(clientActive);
    } finally {
      await prisma.client.delete({ where: { id: taggedClient.id } });
      await prisma.customStatusDefinition.delete({ where: { id: definition.id } });
    }
  });

  it("search still composes correctly alongside the status filter (existing AND structure preserved)", async () => {
    const client = await prisma.client.findUniqueOrThrow({ where: { id: clientActive } });
    const where = await buildClientWhere(fixtures.orgA.id, parseClientListParams({ status: "active", q: client.name }));
    const results = await prisma.client.findMany({ where });
    expect(results.map((r) => r.id)).toContain(clientActive);
  });
});
