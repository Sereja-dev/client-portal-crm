import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { fetchLeadPipelineColumns, PIPELINE_STAGE_CARD_BOUND } from "@/app/(dashboard)/leads/pipeline-query";
import { parseLeadListParams } from "@/app/(dashboard)/leads/query";
import type { RawSearchParams } from "@/lib/list-params";
import { LEAD_STAGES } from "@/lib/leads/stages";
import { bootstrapOrganizationStatusDefinitions } from "@/lib/custom-statuses/bootstrap";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Leads / Sales Pipeline Phase 4 — the Pipeline board's own query layer.
 * Covers RETURN FORMAT §T items 5-9 (org-scoped, archived excluded, all
 * six canonical stages represented, a lead appears in its correct stage,
 * a converted lead appears in WON) and #10 (foreign-org lead absent),
 * plus #11-13 (search/assignee filter reuse) and the truncation contract
 * pipeline-query.ts's own doc comment describes.
 *
 * Custom Statuses Phase 2A — fetchLeadPipelineColumns' own columns now
 * come from the organization's real LEAD CustomStatusDefinitions
 * (Section G), not the hardcoded LEAD_STAGES array directly, so
 * fixtures.orgA (seedTestData's own raw `prisma.organization.create`,
 * never bootstrapped) must be explicitly bootstrapped here — every real
 * organization already is (Phase 1's own bootstrap-on-create + migration
 * backfill), this fixture is the one place that isn't automatic.
 */

const NAME_PREFIX = "Lead-PipelineQuery";

function uniqueName(): string {
  return `${NAME_PREFIX}-${randomUUID().slice(0, 8)}`;
}

function baseListParams(overrides: RawSearchParams = {}) {
  return parseLeadListParams(overrides);
}

describe("Lead pipeline board query (org scoping, stage grouping, filters, truncation)", () => {
  let fixtures: TestFixtures;
  let leadNew: string;
  let leadContacted: string;
  let leadArchived: string;
  let leadConverted: string;
  let convertedClientId: string;
  let leadB: string;

  beforeAll(async () => {
    fixtures = await seedTestData();
    await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgA.id);

    const client = await prisma.client.create({
      data: {
        name: uniqueName(),
        organizationId: fixtures.orgA.id,
        userId: fixtures.owner.id,
      },
    });
    convertedClientId = client.id;

    const [a1, a2, a3, a4, b] = await Promise.all([
      prisma.lead.create({
        data: { name: uniqueName(), organizationId: fixtures.orgA.id, stage: "NEW", company: "Acme Co", email: "prospect@example.com", assignedToUserId: fixtures.owner.id },
      }),
      prisma.lead.create({
        data: { name: uniqueName(), organizationId: fixtures.orgA.id, stage: "CONTACTED" },
      }),
      prisma.lead.create({
        data: { name: uniqueName(), organizationId: fixtures.orgA.id, stage: "NEW", archivedAt: new Date() },
      }),
      prisma.lead.create({
        data: {
          name: uniqueName(),
          organizationId: fixtures.orgA.id,
          stage: "WON",
          convertedClientId: client.id,
          convertedAt: new Date(),
        },
      }),
      prisma.lead.create({
        data: { name: uniqueName(), organizationId: fixtures.orgB.id, stage: "NEW" },
      }),
    ]);
    leadNew = a1.id;
    leadContacted = a2.id;
    leadArchived = a3.id;
    leadConverted = a4.id;
    leadB = b.id;
  });

  afterAll(async () => {
    await prisma.lead.deleteMany({ where: { name: { startsWith: NAME_PREFIX } } });
    await prisma.client.deleteMany({ where: { name: { startsWith: NAME_PREFIX } } });
    await cleanupTestData(fixtures);
  });

  it("1. represents all six canonical stages, in canonical order, even when some are empty", async () => {
    const columns = await fetchLeadPipelineColumns(fixtures.orgA.id, baseListParams());
    expect(columns.map((c) => c.stage)).toEqual(LEAD_STAGES.map((s) => s.value));
    expect(columns.map((c) => c.label)).toEqual(LEAD_STAGES.map((s) => s.label));
  });

  it("2. only returns leads scoped to the caller's own organization", async () => {
    const columns = await fetchLeadPipelineColumns(fixtures.orgA.id, baseListParams());
    const allIds = columns.flatMap((c) => c.leads.map((l) => l.id));
    expect(allIds).toContain(leadNew);
    expect(allIds).not.toContain(leadB);
  });

  it("3. archived leads are excluded by default", async () => {
    const columns = await fetchLeadPipelineColumns(fixtures.orgA.id, baseListParams());
    const allIds = columns.flatMap((c) => c.leads.map((l) => l.id));
    expect(allIds).not.toContain(leadArchived);
    const newColumn = columns.find((c) => c.stage === "NEW")!;
    expect(newColumn.leads.map((l) => l.id)).not.toContain(leadArchived);
  });

  it("archived=1 shows only archived leads, still grouped by stage", async () => {
    const columns = await fetchLeadPipelineColumns(fixtures.orgA.id, baseListParams({ archived: "1" }));
    const newColumn = columns.find((c) => c.stage === "NEW")!;
    expect(newColumn.leads.map((l) => l.id)).toContain(leadArchived);
    expect(newColumn.leads.map((l) => l.id)).not.toContain(leadNew);
  });

  it("4. a lead appears in its own correct stage's column, and no other", async () => {
    const columns = await fetchLeadPipelineColumns(fixtures.orgA.id, baseListParams());
    const newColumn = columns.find((c) => c.stage === "NEW")!;
    const contactedColumn = columns.find((c) => c.stage === "CONTACTED")!;
    expect(newColumn.leads.map((l) => l.id)).toContain(leadNew);
    expect(contactedColumn.leads.map((l) => l.id)).toContain(leadContacted);
    expect(newColumn.leads.map((l) => l.id)).not.toContain(leadContacted);
    expect(contactedColumn.leads.map((l) => l.id)).not.toContain(leadNew);
  });

  it("5. a converted lead appears in the WON column with its convertedClientId intact", async () => {
    const columns = await fetchLeadPipelineColumns(fixtures.orgA.id, baseListParams());
    const wonColumn = columns.find((c) => c.stage === "WON")!;
    const converted = wonColumn.leads.find((l) => l.id === leadConverted);
    expect(converted).toBeDefined();
    expect(converted?.convertedClientId).toBe(convertedClientId);
  });

  it("6. a stray `stage` list-view param never narrows the board down to one column", async () => {
    const columns = await fetchLeadPipelineColumns(fixtures.orgA.id, baseListParams({ stage: "CONTACTED" }));
    // Every stage still has its own column, and NEW's own lead is still
    // present in NEW — the stage param is fully ignored, not applied as
    // a where-clause filter, in the pipeline board's own query.
    expect(columns.map((c) => c.stage)).toEqual(LEAD_STAGES.map((s) => s.value));
    const newColumn = columns.find((c) => c.stage === "NEW")!;
    expect(newColumn.leads.map((l) => l.id)).toContain(leadNew);
  });

  it("7. search matches name/company/email across every column", async () => {
    const byCompany = await fetchLeadPipelineColumns(fixtures.orgA.id, baseListParams({ q: "Acme" }));
    expect(byCompany.flatMap((c) => c.leads.map((l) => l.id))).toContain(leadNew);

    const byEmail = await fetchLeadPipelineColumns(fixtures.orgA.id, baseListParams({ q: "prospect@example" }));
    expect(byEmail.flatMap((c) => c.leads.map((l) => l.id))).toContain(leadNew);

    const noMatch = await fetchLeadPipelineColumns(fixtures.orgA.id, baseListParams({ q: "no-such-lead-xyz" }));
    expect(noMatch.flatMap((c) => c.leads)).toHaveLength(0);
    // Still every column, just all empty — never fewer than 6 columns.
    expect(noMatch).toHaveLength(6);
  });

  it("8. the assignee filter narrows results the same way the list query does", async () => {
    const assigned = await fetchLeadPipelineColumns(fixtures.orgA.id, baseListParams({ assignedToUserId: fixtures.owner.id }));
    expect(assigned.flatMap((c) => c.leads.map((l) => l.id))).toContain(leadNew);

    const unassigned = await fetchLeadPipelineColumns(fixtures.orgA.id, baseListParams({ assignedToUserId: "unassigned" }));
    expect(unassigned.flatMap((c) => c.leads.map((l) => l.id))).not.toContain(leadNew);
  });

  it("9. each column's own total is exact and matches its own leads length when under the bound", async () => {
    const columns = await fetchLeadPipelineColumns(fixtures.orgA.id, baseListParams());
    const contactedColumn = columns.find((c) => c.stage === "CONTACTED")!;
    expect(contactedColumn.total).toBe(contactedColumn.leads.length);
    expect(contactedColumn.truncated).toBe(false);
  });
});

describe("Lead pipeline board query — truncation never lies about completeness", () => {
  let fixtures: TestFixtures;
  const TRUNCATION_PREFIX = "Lead-PipelineTruncation";

  beforeAll(async () => {
    fixtures = await seedTestData();
    await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgA.id);
    const overflow = PIPELINE_STAGE_CARD_BOUND + 5;
    await prisma.lead.createMany({
      data: Array.from({ length: overflow }, (_, i) => ({
        name: `${TRUNCATION_PREFIX}-${i}`,
        organizationId: fixtures.orgA.id,
        stage: "PROPOSAL" as const,
      })),
    });
  });

  afterAll(async () => {
    await prisma.lead.deleteMany({ where: { name: { startsWith: TRUNCATION_PREFIX } } });
    await cleanupTestData(fixtures);
  });

  it("10. a column past the bound reports its real total, a bounded card list, and truncated: true — never fewer leads while claiming to be complete", async () => {
    const columns = await fetchLeadPipelineColumns(fixtures.orgA.id, baseListParams());
    const proposalColumn = columns.find((c) => c.stage === "PROPOSAL")!;
    expect(proposalColumn.total).toBe(PIPELINE_STAGE_CARD_BOUND + 5);
    expect(proposalColumn.leads).toHaveLength(PIPELINE_STAGE_CARD_BOUND);
    expect(proposalColumn.truncated).toBe(true);
  });
});

/**
 * Leads Pipeline P2028 remediation — the real Production org's own shape
 * (6 system + 4 active custom columns = 10, matching the exact
 * confirmed-live Production organization whose real /leads request
 * produced the P2028 transaction-timeout failure). Every query above
 * this point already ran against a system-only 6-column board; these
 * prove the same correctness holds at the real failing shape, on the
 * post-remediation `runWithBoundedConcurrency` implementation (with a
 * cap of `PIPELINE_COLUMN_QUERY_CONCURRENCY` = 5, strictly less than
 * this org's own 10 columns — the exact case the removed transaction
 * could no longer complete within its 5000ms budget).
 */
describe("Lead pipeline board query — 10-column shape (6 system + 4 active custom)", () => {
  let fixtures: TestFixtures;
  let customDefIds: string[];
  let leadInFirstCustomColumn: string;
  let legacyNewLead: string;
  const PREFIX = "Lead-Pipeline10Col";

  beforeAll(async () => {
    fixtures = await seedTestData();
    await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgA.id);

    const customDefs = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        prisma.customStatusDefinition.create({
          data: {
            organizationId: fixtures.orgA.id,
            entityType: "LEAD",
            key: `${PREFIX.toLowerCase()}-custom-${i}`,
            label: `${PREFIX} Custom ${i}`,
            position: 100 + i,
          },
        }),
      ),
    );
    customDefIds = customDefs.map((d) => d.id);

    const [inCustom, legacyNew] = await Promise.all([
      prisma.lead.create({
        data: { name: `${PREFIX}-in-custom`, organizationId: fixtures.orgA.id, stage: "NEW", statusDefinitionId: customDefs[0].id },
      }),
      // statusDefinitionId deliberately left null — the Section D legacy
      // fallback shape every pre-existing test fixture in this file
      // already uses; must land in its own system column only, never
      // absorbed into an unrelated custom one.
      prisma.lead.create({
        data: { name: `${PREFIX}-legacy-new`, organizationId: fixtures.orgA.id, stage: "NEW" },
      }),
    ]);
    leadInFirstCustomColumn = inCustom.id;
    legacyNewLead = legacyNew.id;
  });

  afterAll(async () => {
    await prisma.lead.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await prisma.customStatusDefinition.deleteMany({ where: { id: { in: customDefIds } } });
    await cleanupTestData(fixtures);
  });

  it("A. all 10 columns (6 system + 4 active custom) are returned, in position order, with leads landing in the correct column", async () => {
    const columns = await fetchLeadPipelineColumns(fixtures.orgA.id, baseListParams());
    expect(columns).toHaveLength(10);
    expect(columns.slice(0, 6).map((c) => c.stage)).toEqual(LEAD_STAGES.map((s) => s.value));
    expect(columns.slice(6).map((c) => c.definitionId)).toEqual(customDefIds);

    const firstCustomColumn = columns[6];
    expect(firstCustomColumn.leads.map((l) => l.id)).toContain(leadInFirstCustomColumn);

    const newColumn = columns.find((c) => c.stage === "NEW")!;
    expect(newColumn.leads.map((l) => l.id)).toContain(legacyNewLead);
    for (const customColumn of columns.slice(6)) {
      expect(customColumn.leads.map((l) => l.id)).not.toContain(legacyNewLead);
    }
  });

  it("B. 10 columns, zero matched leads: resolves cleanly, every column present and empty, totals/truncation stay truthful", async () => {
    const columns = await fetchLeadPipelineColumns(
      fixtures.orgA.id,
      baseListParams({ q: "__no_such_lead_pipeline_10col_9f7b__" }),
    );
    expect(columns).toHaveLength(10);
    for (const column of columns) {
      expect(column.leads).toEqual([]);
      expect(column.total).toBe(0);
      expect(column.truncated).toBe(false);
    }
  });
});

/**
 * Leads Pipeline P2028 remediation — durable regression coverage proving
 * the failure mechanism itself (a shared `prisma.$transaction([...])`
 * wrapping every per-column read) cannot silently return, and that the
 * bounded-concurrency replacement preserves the same "one bad column
 * fails the whole board" semantics the transaction used to provide as a
 * side effect of its own all-or-nothing rollback behavior.
 */
describe("Lead pipeline board query — P2028 remediation regression coverage", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
    await bootstrapOrganizationStatusDefinitions(prisma, fixtures.orgA.id);
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("never calls prisma.$transaction — the exact mechanism that produced Production's P2028 timeout cannot silently return", async () => {
    const spy = vi.spyOn(prisma, "$transaction");
    try {
      await fetchLeadPipelineColumns(fixtures.orgA.id, baseListParams());
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("one per-column query rejecting fails the whole fetch — no partial Pipeline result, the original error is not swallowed or replaced", async () => {
    const spy = vi.spyOn(prisma.lead, "findMany").mockRejectedValueOnce(new Error("Injected pipeline column query failure"));
    try {
      await expect(fetchLeadPipelineColumns(fixtures.orgA.id, baseListParams())).rejects.toThrow(
        "Injected pipeline column query failure",
      );
    } finally {
      spy.mockRestore();
    }
  });
});
