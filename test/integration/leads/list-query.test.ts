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

  let qualifiedDefinitionId: string;

  beforeAll(async () => {
    fixtures = await seedTestData();

    // seedTestData() does not run bootstrap.ts's own CustomStatusDefinition
    // seeding (unlike a real new organization) — this fixture org starts
    // with zero CustomStatusDefinition rows. Test 3 below asserts a real
    // `stage` filter narrowing (legacy-enum dual-representation branch of
    // buildLeadWhere), which requires a genuinely resolvable "qualified"
    // definition to exist; without one, "QUALIFIED" would never resolve
    // at all — exactly the stale-key case this whole file's own test 8
    // is about, which would make test 3 pass for the wrong reason (no
    // filter applied) rather than the real one (a correctly resolved
    // SYSTEM definition matching the legacy `stage` column). Seeded here,
    // mirroring SYSTEM_STATUS_DEFINITIONS.LEAD's own real "qualified"
    // entry (constants.ts) so this is the same key/isSystem shape a real
    // organization would actually have.
    const qualifiedDefinition = await prisma.customStatusDefinition.create({
      data: {
        organizationId: fixtures.orgA.id,
        entityType: "LEAD",
        key: "qualified",
        label: "Qualified",
        position: 2,
        isSystem: true,
      },
    });
    qualifiedDefinitionId = qualifiedDefinition.id;

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
    await prisma.customStatusDefinition.delete({ where: { id: qualifiedDefinitionId } });
    await cleanupTestData(fixtures);
  });

  it("1. only returns leads scoped to the caller's own organization", async () => {
    const where = await buildLeadWhere(fixtures.orgA.id, parseLeadListParams({}));
    const results = await prisma.lead.findMany({ where });
    const ids = results.map((r) => r.id);
    expect(ids).toContain(leadA1);
    expect(ids).not.toContain(leadB);
  });

  it("2. archived leads are excluded by default", async () => {
    const where = await buildLeadWhere(fixtures.orgA.id, parseLeadListParams({}));
    const results = await prisma.lead.findMany({ where });
    expect(results.map((r) => r.id)).not.toContain(leadA2Archived);
  });

  it("the archived=1 filter shows only archived leads", async () => {
    const where = await buildLeadWhere(fixtures.orgA.id, parseLeadListParams({ archived: "1" }));
    const results = await prisma.lead.findMany({ where });
    const ids = results.map((r) => r.id);
    expect(ids).toContain(leadA2Archived);
    expect(ids).not.toContain(leadA1);
  });

  it("3. the stage filter narrows results", async () => {
    const where = await buildLeadWhere(fixtures.orgA.id, parseLeadListParams({ stage: "QUALIFIED" }));
    const results = await prisma.lead.findMany({ where });
    const ids = results.map((r) => r.id);
    expect(ids).toContain(leadA1);
    expect(ids).not.toContain(leadA2Archived);
  });

  it("4. the assignee filter narrows results, and 'unassigned' is a real distinct filter value", async () => {
    const assignedWhere = await buildLeadWhere(fixtures.orgA.id, parseLeadListParams({ assignedToUserId: fixtures.owner.id }));
    const assignedResults = await prisma.lead.findMany({ where: assignedWhere });
    expect(assignedResults.map((r) => r.id)).toContain(leadA1);

    const unassignedWhere = await buildLeadWhere(fixtures.orgA.id, parseLeadListParams({ assignedToUserId: "unassigned" }));
    const unassignedResults = await prisma.lead.findMany({ where: unassignedWhere });
    expect(unassignedResults.map((r) => r.id)).not.toContain(leadA1);
  });

  it("5. search matches name", async () => {
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadA1 } });
    const where = await buildLeadWhere(fixtures.orgA.id, parseLeadListParams({ q: lead.name }));
    const results = await prisma.lead.findMany({ where });
    expect(results.map((r) => r.id)).toContain(leadA1);
  });

  it("6. search matches company", async () => {
    const where = await buildLeadWhere(fixtures.orgA.id, parseLeadListParams({ q: "Acme" }));
    const results = await prisma.lead.findMany({ where });
    expect(results.map((r) => r.id)).toContain(leadA1);
  });

  it("7. search matches email", async () => {
    const where = await buildLeadWhere(fixtures.orgA.id, parseLeadListParams({ q: "prospect@example" }));
    const results = await prisma.lead.findMany({ where });
    expect(results.map((r) => r.id)).toContain(leadA1);
  });

  it("8. an invalid/unresolved stage query param now fails CLOSED — zero rows, never silently \"no filter\" (stale custom-status filter hardening)", async () => {
    // Custom Statuses Phase 2B (Section P): `stage` is no longer
    // validated against a fixed enum at parse time (it's now a
    // CustomStatusDefinition key, resolved live against the database) —
    // parseLeadListParams only lower-cases it, so a garbage value simply
    // fails to resolve to any real definition inside buildLeadWhere.
    //
    // Stale custom-status filter hardening — this USED to fall back to
    // "no filter at all" here (confirmed by this exact test case's own
    // prior assertion, before this fix), silently broadening "leads at
    // stage X" into "all leads" — a real, reproduced pre-existing
    // defect, not a hypothetical one. It now fails CLOSED instead: a
    // deterministic zero-match `where`, so the stale filter intent is
    // preserved (zero results) rather than discarded.
    const params = parseLeadListParams({ stage: "NOT_A_REAL_STAGE" });
    expect(params.stage).toBe("not_a_real_stage");
    const where = await buildLeadWhere(fixtures.orgA.id, params);
    const results = await prisma.lead.findMany({ where });
    expect(results).toHaveLength(0);
  });

  it("a stage key that only exists in a DIFFERENT organization resolves to zero rows in this one — never a cross-org leak, indistinguishable from a totally nonexistent key", async () => {
    const foreignDefinition = await prisma.customStatusDefinition.create({
      data: {
        organizationId: fixtures.orgB.id,
        entityType: "LEAD",
        key: "foreign-only-lead-stage",
        label: "Foreign Only Stage",
        position: 999,
      },
    });
    try {
      const where = await buildLeadWhere(fixtures.orgA.id, parseLeadListParams({ stage: foreignDefinition.key }));
      const results = await prisma.lead.findMany({ where });
      expect(results).toHaveLength(0);
    } finally {
      await prisma.customStatusDefinition.delete({ where: { id: foreignDefinition.id } });
    }
  });

  it("a real but ARCHIVED custom stage definition remains a valid filter — still narrows correctly, never treated as unresolved", async () => {
    const definition = await prisma.customStatusDefinition.create({
      data: {
        organizationId: fixtures.orgA.id,
        entityType: "LEAD",
        key: "archived-lead-stage-for-list-query-test",
        label: "Archived Lead Stage",
        position: 998,
        archivedAt: new Date(),
      },
    });
    const taggedLead = await prisma.lead.create({
      data: { name: uniqueName(), organizationId: fixtures.orgA.id, statusDefinitionId: definition.id },
    });
    try {
      const where = await buildLeadWhere(fixtures.orgA.id, parseLeadListParams({ stage: definition.key }));
      const results = await prisma.lead.findMany({ where });
      const ids = results.map((r) => r.id);
      expect(ids).toContain(taggedLead.id);
      expect(ids).not.toContain(leadA1);
    } finally {
      await prisma.lead.delete({ where: { id: taggedLead.id } });
      await prisma.customStatusDefinition.delete({ where: { id: definition.id } });
    }
  });

  it("9. an assignee param naming a real user in a DIFFERENT organization cannot leak or widen scope — just returns nothing (the org scope alone already excludes it)", async () => {
    const where = await buildLeadWhere(fixtures.orgA.id, parseLeadListParams({ assignedToUserId: fixtures.orgBOwner.id }));
    const results = await prisma.lead.findMany({ where });
    expect(results).toHaveLength(0);
  });

  it("a non-UUID assignee param fails safely — treated as no filter", async () => {
    const params = parseLeadListParams({ assignedToUserId: "not-a-uuid" });
    expect(params.assignedToUserId).toBeUndefined();
  });
});
