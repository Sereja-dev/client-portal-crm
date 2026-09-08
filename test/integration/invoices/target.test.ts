import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resolveInvoiceTarget } from "@/lib/invoices/target";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Quotes / Estimates Phase 2.3 — resolveInvoiceTarget's own durable
 * invariant: clientId REQUIRED, projectId OPTIONAL; when supplied, the
 * Project must belong to this exact organization AND to the resolved
 * Client. Mirrors src/lib/quotes/target.ts's own test coverage style
 * (resolveQuoteTarget), the direct precedent this module was built from.
 */
describe("resolveInvoiceTarget", () => {
  let fixtures: TestFixtures;
  let clientA2: { id: string };
  let projectA2: { id: string };

  beforeAll(async () => {
    fixtures = await seedTestData();
    clientA2 = await prisma.client.create({
      data: { name: `Target Second Client ${fixtures.runId}`, userId: fixtures.owner.id, organizationId: fixtures.orgA.id },
    });
    projectA2 = await prisma.project.create({
      data: {
        name: `Target Second Project ${fixtures.runId}`,
        clientId: clientA2.id,
        organizationId: fixtures.orgA.id,
        ownerId: fixtures.owner.id,
        status: "IN_PROGRESS",
      },
    });
  });

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { id: projectA2.id } });
    await prisma.client.deleteMany({ where: { id: clientA2.id } });
    await cleanupTestData(fixtures);
  });

  it("1. a valid Client with no Project resolves to a project-less target", async () => {
    const result = await resolveInvoiceTarget(prisma, fixtures.orgA.id, { clientId: fixtures.clientA.id, projectId: null });
    expect(result).toEqual({ ok: true, target: { clientId: fixtures.clientA.id, projectId: null } });
  });

  it("2. a valid Client + a Project that belongs to it resolves both", async () => {
    const result = await resolveInvoiceTarget(prisma, fixtures.orgA.id, {
      clientId: fixtures.clientA.id,
      projectId: fixtures.project.id,
    });
    expect(result).toEqual({ ok: true, target: { clientId: fixtures.clientA.id, projectId: fixtures.project.id } });
  });

  it("4. a nonexistent/foreign Client is rejected", async () => {
    const foreign = await resolveInvoiceTarget(prisma, fixtures.orgA.id, { clientId: fixtures.clientB.id, projectId: null });
    expect(foreign).toEqual({ ok: false, reason: "invalid_target" });

    const nonexistent = await resolveInvoiceTarget(prisma, fixtures.orgA.id, { clientId: randomUUID(), projectId: null });
    expect(nonexistent).toEqual({ ok: false, reason: "invalid_target" });
  });

  it("5. a nonexistent/foreign Project is rejected", async () => {
    const result = await resolveInvoiceTarget(prisma, fixtures.orgA.id, {
      clientId: fixtures.clientA.id,
      projectId: randomUUID(),
    });
    expect(result).toEqual({ ok: false, reason: "invalid_target" });
  });

  it("6. a Project belonging to a DIFFERENT Client in the same organization is rejected", async () => {
    const result = await resolveInvoiceTarget(prisma, fixtures.orgA.id, {
      clientId: fixtures.clientA.id,
      projectId: projectA2.id, // belongs to clientA2, not clientA
    });
    expect(result).toEqual({ ok: false, reason: "invalid_target" });
  });

  it("a Project belonging to a different organization entirely is rejected, even paired with a valid same-org Client", async () => {
    const foreignProject = await prisma.project.create({
      data: { name: "Foreign org project", clientId: fixtures.clientB.id, organizationId: fixtures.orgB.id, ownerId: fixtures.orgBOwner.id, status: "IN_PROGRESS" },
    });
    try {
      const result = await resolveInvoiceTarget(prisma, fixtures.orgA.id, {
        clientId: fixtures.clientA.id,
        projectId: foreignProject.id,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_target" });
    } finally {
      await prisma.project.deleteMany({ where: { id: foreignProject.id } });
    }
  });

  it("never reveals whether a rejected id exists in another org vs doesn't exist at all — identical result either way", async () => {
    const crossOrgClient = await resolveInvoiceTarget(prisma, fixtures.orgA.id, { clientId: fixtures.clientB.id, projectId: null });
    const nonexistentClient = await resolveInvoiceTarget(prisma, fixtures.orgA.id, { clientId: randomUUID(), projectId: null });
    expect(crossOrgClient).toEqual(nonexistentClient);
  });
});
