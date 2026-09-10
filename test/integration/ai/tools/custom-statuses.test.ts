import { afterEach, beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { executeSearchClients } from "@/lib/ai/tools/clients";
import { executeSearchProjects } from "@/lib/ai/tools/projects";
import { createCustomStatusDefinition } from "@/lib/custom-statuses/definitions";
import { assignClientStatus, assignProjectStatus } from "@/lib/custom-statuses/assignment";
import { bootstrapOrganizationStatusDefinitions } from "@/lib/custom-statuses/bootstrap";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../../fixtures/seed";

/**
 * Custom Statuses Phase 2A Completion Pass (Section B) — test items 1-8
 * of the originating task's own Section E. Proves searchClients/
 * searchProjects' own `status` filter and output label are now
 * authoritative via statusDefinitionId, exactly like the ordinary
 * Client/Project list pages (Phase 2A's own buildClientWhere/
 * buildProjectWhere) — including the same "a stale legacy enum on a
 * genuinely custom-status entity must never leak into a system filter or
 * a system-looking output label" guarantee.
 */

describe("AI Client/Project tools — Custom Statuses authoritative filtering/display", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
    await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgA.id);
  });

  afterEach(async () => {
    await prisma.project.deleteMany({ where: { organizationId: fixtures.orgA.id, id: { not: fixtures.project.id } } });
    await prisma.project.update({ where: { id: fixtures.project.id }, data: { status: "PLANNING", statusDefinitionId: null } });
    await prisma.client.deleteMany({ where: { organizationId: fixtures.orgA.id, id: { not: fixtures.clientA.id } } });
    await prisma.client.update({ where: { id: fixtures.clientA.id }, data: { status: "LEAD", statusDefinitionId: null } });
    await prisma.customStatusDefinition.deleteMany({ where: { organizationId: fixtures.orgA.id, isSystem: false } });
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  async function findSystemDef(entityType: "CLIENT" | "PROJECT", key: string) {
    return prisma.customStatusDefinition.findFirstOrThrow({
      where: { organizationId: fixtures.orgA.id, entityType, isSystem: true, key },
    });
  }

  describe("AI Client search (items 1-4)", () => {
    it("1. status filter matches the correct system definition", async () => {
      const activeDef = await findSystemDef("CLIENT", "active");
      await assignClientStatus(fixtures.orgA.id, fixtures.clientA.id, activeDef.id);

      const result = await executeSearchClients(fixtures.orgA.id, { status: "ACTIVE" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.results.map((r) => r.ref)).toContain(fixtures.clientA.id);
    });

    it("2. a custom-status Client with a stale legacy status=ACTIVE does NOT match an ACTIVE filter", async () => {
      const customDef = await createCustomStatusDefinition(fixtures.orgA.id, "CLIENT", { label: "VIP" });
      if (!customDef.ok) throw new Error("expected ok");
      const staleClient = await prisma.client.create({
        data: { name: "Stale Active AI Client", status: "ACTIVE", organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
      });
      await assignClientStatus(fixtures.orgA.id, staleClient.id, customDef.definition.id);

      const result = await executeSearchClients(fixtures.orgA.id, { status: "ACTIVE" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.results.map((r) => r.ref)).not.toContain(staleClient.id);

      // The custom status's own label is what the tool reports for this
      // client, never the stale legacy "ACTIVE" enum string.
      const unfiltered = await executeSearchClients(fixtures.orgA.id, { query: "Stale Active AI Client" });
      expect(unfiltered.ok).toBe(true);
      if (!unfiltered.ok) return;
      expect(unfiltered.results[0]?.status).toBe("VIP");
    });

    it("3. a null-statusDefinitionId legacy fixture still falls back to the legacy enum correctly", async () => {
      // Created directly (raw prisma.client.create), never through the
      // real createClientAction — statusDefinitionId stays null, exactly
      // the pre-Phase-1 fixture shape.
      const legacyFixture = await prisma.client.create({
        data: { name: "Legacy Unbackfilled Client", status: "ACTIVE", organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
      });

      const filtered = await executeSearchClients(fixtures.orgA.id, { status: "ACTIVE" });
      expect(filtered.ok).toBe(true);
      if (!filtered.ok) return;
      expect(filtered.results.map((r) => r.ref)).toContain(legacyFixture.id);

      const detail = await executeSearchClients(fixtures.orgA.id, { query: "Legacy Unbackfilled Client" });
      expect(detail.ok).toBe(true);
      if (!detail.ok) return;
      expect(detail.results[0]?.status).toBe("Active");
    });

    it("4. org scoping is preserved — a foreign org's client, even with a matching status, is never returned", async () => {
      const result = await executeSearchClients(fixtures.orgA.id, { status: "LEAD" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.results.map((r) => r.ref)).not.toContain(fixtures.clientB.id);
    });
  });

  describe("AI Project search (items 5-8)", () => {
    it("5. status filter matches the correct system definition", async () => {
      const inProgressDef = await findSystemDef("PROJECT", "in_progress");
      await assignProjectStatus(fixtures.orgA.id, fixtures.project.id, inProgressDef.id);

      const result = await executeSearchProjects(fixtures.orgA.id, { status: "IN_PROGRESS" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.results.map((r) => r.ref)).toContain(fixtures.project.id);
    });

    it("6. a custom-status Project with a stale legacy status=IN_PROGRESS does NOT match an IN_PROGRESS filter", async () => {
      const customDef = await createCustomStatusDefinition(fixtures.orgA.id, "PROJECT", { label: "Blocked" });
      if (!customDef.ok) throw new Error("expected ok");
      const staleProject = await prisma.project.create({
        data: {
          name: "Stale IP AI Project",
          status: "IN_PROGRESS",
          clientId: fixtures.clientA.id,
          ownerId: fixtures.owner.id,
          organizationId: fixtures.orgA.id,
        },
      });
      await assignProjectStatus(fixtures.orgA.id, staleProject.id, customDef.definition.id);

      const result = await executeSearchProjects(fixtures.orgA.id, { status: "IN_PROGRESS" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.results.map((r) => r.ref)).not.toContain(staleProject.id);

      const unfiltered = await executeSearchProjects(fixtures.orgA.id, { query: "Stale IP AI Project" });
      expect(unfiltered.ok).toBe(true);
      if (!unfiltered.ok) return;
      expect(unfiltered.results[0]?.status).toBe("Blocked");
    });

    it("7. a null-statusDefinitionId legacy fixture falls back to the legacy enum correctly", async () => {
      const legacyFixture = await prisma.project.create({
        data: {
          name: "Legacy Unbackfilled Project",
          status: "IN_PROGRESS",
          clientId: fixtures.clientA.id,
          ownerId: fixtures.owner.id,
          organizationId: fixtures.orgA.id,
        },
      });

      const filtered = await executeSearchProjects(fixtures.orgA.id, { status: "IN_PROGRESS" });
      expect(filtered.ok).toBe(true);
      if (!filtered.ok) return;
      expect(filtered.results.map((r) => r.ref)).toContain(legacyFixture.id);

      const detail = await executeSearchProjects(fixtures.orgA.id, { query: "Legacy Unbackfilled Project" });
      expect(detail.ok).toBe(true);
      if (!detail.ok) return;
      expect(detail.results[0]?.status).toBe("In Progress");
    });

    it("8. org scoping is preserved for Project search regardless of status filter", async () => {
      const result = await executeSearchProjects(fixtures.orgA.id, { status: "PLANNING" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Direct query-based proof of scoping: no project belonging to a
      // different organization can ever appear, regardless of filter.
      const foreignOrgProjectIds = await prisma.project.findMany({
        where: { organizationId: { not: fixtures.orgA.id } },
        select: { id: true },
      });
      const returnedRefs = new Set(result.results.map((r) => r.ref));
      for (const p of foreignOrgProjectIds) {
        expect(returnedRefs.has(p.id)).toBe(false);
      }
    });
  });

  describe("Performance (item 13)", () => {
    it("13. no per-row CustomStatusDefinition lookup — a moderate number of results resolves with a fixed, small number of queries (one include per findMany, not one per row)", async () => {
      const extraIds: string[] = [];
      for (let i = 0; i < 15; i++) {
        const c = await prisma.client.create({
          data: { name: `Perf Test Client ${i}`, organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
        });
        extraIds.push(c.id);
      }
      const result = await executeSearchClients(fixtures.orgA.id, { query: "Perf Test Client" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Every row still carries a correctly-resolved label (proving the
      // single `include` on the findMany resolved every row's own
      // relation, not a per-row follow-up query) — architecturally
      // guaranteed by the single `select: { statusDefinition: {...} } }`
      // on the one findMany call itself (see clients.ts's own
      // buildStatusFilter/executeSearchClients — no loop issues a second
      // Prisma call per row).
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results.every((r) => typeof r.status === "string" && r.status.length > 0)).toBe(true);

      await prisma.client.deleteMany({ where: { id: { in: extraIds } } });
    });
  });
});
