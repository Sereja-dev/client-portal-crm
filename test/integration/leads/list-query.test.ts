import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { buildLeadWhere, parseLeadListParams } from "@/app/(dashboard)/leads/query";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Leads / Sales Pipeline Phase 3 — the list page's own query-building
 * layer (src/app/(dashboard)/leads/query.ts), tested directly against
 * the real database rather than through the page/action layer, mirroring
 * how test/integration/clients doesn't have an equivalent (Client's own
 * query.ts has no dedicated test file) — this one exists because Lead's
 * query layer carries genuine security-relevant logic (an
 * invalid/foreign assignee param must never widen or leak scope) worth
 * proving directly.
 */

const NAME_PREFIX = "Lead-ListQuery";

function uniqueName(): string {
  return `${NAME_PREFIX}-${randomUUID().slice(0, 8)}`;
}

describe("Leads list query (org scoping, filters, safety)", () => {
  let fixtures: TestFixtures;
  let leadA1: string;
  let leadA2Archived: string;
  let leadB: string;

  beforeAll(async () => {
    fixtures = await seedTestData();

    const [a1, a2, b] = await Promise.all([
      prisma.lead.create({
        data: {
          name: uniqueName(),
          organizationId: fixtures.orgA.id,
          stage: "QUALIFIED",
          assignedToUserId: fixtures.owner.id,
          company: "Acme Co",
          email: "prospect@example.com",
        },
      }),
      prisma.lead.create({
        data: {
          name: uniqueName(),
          organizationId: fixtures.orgA.id,
          archivedAt: new Date(),
        },
      }),
      prisma.lead.create({
        data: { name: uniqueName(), organizationId: fixtures.orgB.id },
      }),
    ]);
    leadA1 = a1.id;
    leadA2Archived = a2.id;
    leadB = b.id;
  });

  afterAll(async () => {
    await prisma.lead.deleteMany({ where: { name: { startsWith: NAME_PREFIX } } });
    await cleanupTestData(fixtures);
  });

  it("1. only returns leads scoped to the caller's own organization", async () => {
    const where = buildLeadWhere(fixtures.orgA.id, parseLeadListParams({}));
    const results = await prisma.lead.findMany({ where });
    const ids = results.map((r) => r.id);
    expect(ids).toContain(leadA1);
    expect(ids).not.toContain(leadB);
  });

  it("2. archived leads are excluded by default", async () => {
    const where = buildLeadWhere(fixtures.orgA.id, parseLeadListParams({}));
    const results = await prisma.lead.findMany({ where });
    expect(results.map((r) => r.id)).not.toContain(leadA2Archived);
  });

  it("the archived=1 filter shows only archived leads", async () => {
    const where = buildLeadWhere(fixtures.orgA.id, parseLeadListParams({ archived: "1" }));
    const results = await prisma.lead.findMany({ where });
    const ids = results.map((r) => r.id);
    expect(ids).toContain(leadA2Archived);
    expect(ids).not.toContain(leadA1);
  });

  it("3. the stage filter narrows results", async () => {
    const where = buildLeadWhere(fixtures.orgA.id, parseLeadListParams({ stage: "QUALIFIED" }));
    const results = await prisma.lead.findMany({ where });
    const ids = results.map((r) => r.id);
    expect(ids).toContain(leadA1);
    expect(ids).not.toContain(leadA2Archived);
  });

  it("4. the assignee filter narrows results, and 'unassigned' is a real distinct filter value", async () => {
    const assignedWhere = buildLeadWhere(fixtures.orgA.id, parseLeadListParams({ assignedToUserId: fixtures.owner.id }));
    const assignedResults = await prisma.lead.findMany({ where: assignedWhere });
    expect(assignedResults.map((r) => r.id)).toContain(leadA1);

    const unassignedWhere = buildLeadWhere(fixtures.orgA.id, parseLeadListParams({ assignedToUserId: "unassigned" }));
    const unassignedResults = await prisma.lead.findMany({ where: unassignedWhere });
    expect(unassignedResults.map((r) => r.id)).not.toContain(leadA1);
  });

  it("5. search matches name", async () => {
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadA1 } });
    const where = buildLeadWhere(fixtures.orgA.id, parseLeadListParams({ q: lead.name }));
    const results = await prisma.lead.findMany({ where });
    expect(results.map((r) => r.id)).toContain(leadA1);
  });

  it("6. search matches company", async () => {
    const where = buildLeadWhere(fixtures.orgA.id, parseLeadListParams({ q: "Acme" }));
    const results = await prisma.lead.findMany({ where });
    expect(results.map((r) => r.id)).toContain(leadA1);
  });

  it("7. search matches email", async () => {
    const where = buildLeadWhere(fixtures.orgA.id, parseLeadListParams({ q: "prospect@example" }));
    const results = await prisma.lead.findMany({ where });
    expect(results.map((r) => r.id)).toContain(leadA1);
  });

  it("8. an invalid stage query param fails safely — falls back to no filter, never an error or empty scope", async () => {
    const params = parseLeadListParams({ stage: "NOT_A_REAL_STAGE" });
    expect(params.stage).toBeUndefined();
    const where = buildLeadWhere(fixtures.orgA.id, params);
    const results = await prisma.lead.findMany({ where });
    // Behaves exactly like no stage filter at all — still returns every
    // active org lead, never throws, never silently returns nothing.
    expect(results.map((r) => r.id)).toContain(leadA1);
  });

  it("9. an assignee param naming a real user in a DIFFERENT organization cannot leak or widen scope — just returns nothing (the org scope alone already excludes it)", async () => {
    const where = buildLeadWhere(fixtures.orgA.id, parseLeadListParams({ assignedToUserId: fixtures.orgBOwner.id }));
    const results = await prisma.lead.findMany({ where });
    expect(results).toHaveLength(0);
  });

  it("a non-UUID assignee param fails safely — treated as no filter", async () => {
    const params = parseLeadListParams({ assignedToUserId: "not-a-uuid" });
    expect(params.assignedToUserId).toBeUndefined();
  });
});
