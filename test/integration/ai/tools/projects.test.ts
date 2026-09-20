import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../../fixtures/seed";
import { executeSearchProjects } from "@/lib/ai/tools/projects";

describe("executeSearchProjects — integration", () => {
  let fixtures: TestFixtures;
  let sensitiveProjectId: string;

  beforeAll(async () => {
    fixtures = await seedTestData();
    const sensitive = await prisma.project.create({
      data: {
        name: "Sensitive Project",
        clientId: fixtures.clientA.id,
        organizationId: fixtures.orgA.id,
        ownerId: fixtures.owner.id,
        status: "PLANNING",
        description: "CONFIDENTIAL scope: undisclosed acquisition target due diligence.",
        budget: 250000,
      },
    });
    sensitiveProjectId = sensitive.id;
  });

  afterAll(async () => {
    await prisma.project.delete({ where: { id: sensitiveProjectId } });
    await cleanupTestData(fixtures);
  });

  it("returns only the caller's own-org projects", async () => {
    const result = await executeSearchProjects(fixtures.orgA.id, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.results.map((r) => r.ref)).toContain(fixtures.project.id);
  });

  it("no-match returns an empty array, never an error", async () => {
    const result = await executeSearchProjects(fixtures.orgA.id, { query: "zzz-no-such-project-zzz" });
    expect(result).toEqual({ ok: true, results: [] });
  });

  it("filters by status", async () => {
    const result = await executeSearchProjects(fixtures.orgA.id, { status: "PLANNING" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.results.some((r) => r.ref === sensitiveProjectId)).toBe(true);
  });

  it("clientRef filter is safe: a foreign-org clientRef yields empty results, never an error or existence signal", async () => {
    const result = await executeSearchProjects(fixtures.orgA.id, { clientRef: fixtures.clientB.id });
    expect(result).toEqual({ ok: true, results: [] });
  });

  it("clientRef filter narrows correctly for an own-org client", async () => {
    const result = await executeSearchProjects(fixtures.orgA.id, { clientRef: fixtures.clientA.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.results.map((r) => r.ref)).toContain(fixtures.project.id);
  });

  it("returns exactly the approved 4 fields — description/budget/ownerId never survive projection", async () => {
    const result = await executeSearchProjects(fixtures.orgA.id, { query: "Sensitive Project" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const hit = result.results.find((r) => r.ref === sensitiveProjectId);
    expect(hit).toBeDefined();
    expect(Object.keys(hit!).sort()).toEqual(["ref", "name", "status", "clientName"].sort());
    const serialized = JSON.stringify(hit);
    expect(serialized).not.toMatch(/CONFIDENTIAL/);
    expect(serialized).not.toMatch(/250000/);
    expect(serialized).not.toMatch(/acquisition/i);
  });

  it("respects the fixed cap of 10", async () => {
    const extraIds: string[] = [];
    try {
      for (let i = 0; i < 12; i++) {
        const p = await prisma.project.create({
          data: { name: `Cap Test Project ${i}`, clientId: fixtures.clientA.id, organizationId: fixtures.orgA.id, ownerId: fixtures.owner.id },
        });
        extraIds.push(p.id);
      }
      const result = await executeSearchProjects(fixtures.orgA.id, { query: "Cap Test Project" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.results.length).toBe(10);
    } finally {
      await prisma.project.deleteMany({ where: { id: { in: extraIds } } });
    }
  });

  it("Multi-Entity Search Matching Fix — a combined client-name + project-name query finds the project, even though neither field alone contains the whole query", async () => {
    const client = await prisma.client.findUniqueOrThrow({ where: { id: fixtures.clientA.id } });
    const project = await prisma.project.findUniqueOrThrow({ where: { id: fixtures.project.id } });
    const combinedQuery = `${client.name} ${project.name}`; // e.g. "Test Client A Test Project"
    expect(combinedQuery.length).toBeLessThanOrEqual(100);

    const result = await executeSearchProjects(fixtures.orgA.id, { query: combinedQuery });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.results.some((r) => r.ref === fixtures.project.id)).toBe(true);
  });

  it("a combined query pairing an unrelated client with a real project name matches nothing — every token must be satisfied on the SAME project row, never aggregated across rows", async () => {
    const clientB = await prisma.client.findUniqueOrThrow({ where: { id: fixtures.clientB.id } });
    const project = await prisma.project.findUniqueOrThrow({ where: { id: fixtures.project.id } });
    // clientB has no project of its own in this fixture, and `project`
    // belongs only to clientA — no single project row can ever satisfy
    // both "clientB.name" and "project.name" tokens at once.
    const mismatchedQuery = `${clientB.name} ${project.name}`;
    const result = await executeSearchProjects(fixtures.orgA.id, { query: mismatchedQuery });
    expect(result).toEqual({ ok: true, results: [] });
  });
});
