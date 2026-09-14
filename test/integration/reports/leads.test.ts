import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getNewLeadsCount, getConvertedLeadsCount, getLeadPipelineSnapshot } from "@/lib/reports/queries/leads";
import { getReportsPeriodRange } from "@/lib/reports/period";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { createExtraLead, cleanupExtraReportsData } from "./helpers";

const NOW = new Date("2026-06-15T12:00:00.000Z");
const RANGE = getReportsPeriodRange("this_month", NOW); // 2026-06-01T00:00Z .. 2026-07-01T00:00Z (exclusive)

describe("Reports Lead queries", () => {
  let fixtures: TestFixtures;
  let leadIds: string[];

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    await cleanupExtraReportsData({ leadIds });
    leadIds = [];
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  describe("getNewLeadsCount", () => {
    it("counts Leads created within [range.start, range.end)", async () => {
      const inside = await createExtraLead({ organizationId: fixtures.orgA.id, createdAt: new Date("2026-06-10T00:00:00.000Z") });
      const beforeRange = await createExtraLead({ organizationId: fixtures.orgA.id, createdAt: new Date("2026-05-31T23:59:59.999Z") });
      const afterRange = await createExtraLead({ organizationId: fixtures.orgA.id, createdAt: new Date("2026-07-01T00:00:00.000Z") }); // == end, exclusive
      leadIds = [inside.id, beforeRange.id, afterRange.id];

      expect(await getNewLeadsCount(fixtures.orgA.id, RANGE)).toBe(1);
    });

    it("includes a Lead created exactly at range.start (inclusive)", async () => {
      const atStart = await createExtraLead({ organizationId: fixtures.orgA.id, createdAt: RANGE.start });
      leadIds = [atStart.id];
      expect(await getNewLeadsCount(fixtures.orgA.id, RANGE)).toBe(1);
    });

    it("a historically-created Lead still counts even after being archived later -- archiving never erases the creation event", async () => {
      const lead = await createExtraLead({
        organizationId: fixtures.orgA.id,
        createdAt: new Date("2026-06-10T00:00:00.000Z"),
        archivedAt: new Date("2026-06-12T00:00:00.000Z"),
      });
      leadIds = [lead.id];
      expect(await getNewLeadsCount(fixtures.orgA.id, RANGE)).toBe(1);
    });

    it("current stage never affects this count", async () => {
      const won = await createExtraLead({ organizationId: fixtures.orgA.id, createdAt: new Date("2026-06-10T00:00:00.000Z"), stage: "WON" });
      const lost = await createExtraLead({ organizationId: fixtures.orgA.id, createdAt: new Date("2026-06-11T00:00:00.000Z"), stage: "LOST" });
      leadIds = [won.id, lost.id];
      expect(await getNewLeadsCount(fixtures.orgA.id, RANGE)).toBe(2);
    });

    it("never leaks a foreign tenant's Lead", async () => {
      const foreign = await createExtraLead({ organizationId: fixtures.orgB.id, createdAt: new Date("2026-06-10T00:00:00.000Z") });
      leadIds = [foreign.id];
      expect(await getNewLeadsCount(fixtures.orgA.id, RANGE)).toBe(0);
    });
  });

  describe("getConvertedLeadsCount", () => {
    it("counts Leads by convertedAt, not stage", async () => {
      const converted = await createExtraLead({ organizationId: fixtures.orgA.id, stage: "WON", convertedAt: new Date("2026-06-10T00:00:00.000Z") });
      leadIds = [converted.id];
      expect(await getConvertedLeadsCount(fixtures.orgA.id, RANGE)).toBe(1);
    });

    it("a Lead at stage=WON with convertedAt still null does NOT count as converted -- stage and conversion are independent, deliberate events", async () => {
      const wonNotConverted = await createExtraLead({ organizationId: fixtures.orgA.id, stage: "WON", convertedAt: null });
      leadIds = [wonNotConverted.id];
      expect(await getConvertedLeadsCount(fixtures.orgA.id, RANGE)).toBe(0);
    });

    it("a conversion outside the range does not count, even if the Lead was created inside it", async () => {
      const lead = await createExtraLead({
        organizationId: fixtures.orgA.id,
        createdAt: new Date("2026-06-05T00:00:00.000Z"),
        convertedAt: new Date("2026-08-01T00:00:00.000Z"),
      });
      leadIds = [lead.id];
      expect(await getConvertedLeadsCount(fixtures.orgA.id, RANGE)).toBe(0);
    });

    it("a historical conversion event still counts even after the Lead is archived later", async () => {
      const lead = await createExtraLead({
        organizationId: fixtures.orgA.id,
        stage: "WON",
        convertedAt: new Date("2026-06-10T00:00:00.000Z"),
        archivedAt: new Date("2026-06-20T00:00:00.000Z"),
      });
      leadIds = [lead.id];
      expect(await getConvertedLeadsCount(fixtures.orgA.id, RANGE)).toBe(1);
    });

    it("never leaks a foreign tenant's conversion", async () => {
      const foreign = await createExtraLead({ organizationId: fixtures.orgB.id, convertedAt: new Date("2026-06-10T00:00:00.000Z") });
      leadIds = [foreign.id];
      expect(await getConvertedLeadsCount(fixtures.orgA.id, RANGE)).toBe(0);
    });
  });

  describe("getLeadPipelineSnapshot -- current snapshot only", () => {
    it("returns every canonical stage in pipeline order, zero-filled, even with no Leads at all", async () => {
      const snapshot = await getLeadPipelineSnapshot(fixtures.orgB.id); // org B has zero Leads
      expect(snapshot.stages.map((s) => s.stage)).toEqual(["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "WON", "LOST"]);
      expect(snapshot.stages.every((s) => s.count === 0)).toBe(true);
      expect(snapshot.activePipelineValue).toBe(0);
    });

    it("groups by current stage, not by when the Lead was created", async () => {
      const qualified = await createExtraLead({ organizationId: fixtures.orgA.id, stage: "QUALIFIED", createdAt: new Date("2020-01-01T00:00:00.000Z") });
      const proposal = await createExtraLead({ organizationId: fixtures.orgA.id, stage: "PROPOSAL" });
      leadIds = [qualified.id, proposal.id];

      const snapshot = await getLeadPipelineSnapshot(fixtures.orgA.id);
      const byStage = new Map(snapshot.stages.map((s) => [s.stage, s.count]));
      expect(byStage.get("QUALIFIED")).toBe(1);
      expect(byStage.get("PROPOSAL")).toBe(1);
    });

    it("excludes archived Leads from both stage counts and pipeline value", async () => {
      const activeQualified = await createExtraLead({ organizationId: fixtures.orgA.id, stage: "QUALIFIED", value: "1000.00" });
      const archivedQualified = await createExtraLead({ organizationId: fixtures.orgA.id, stage: "QUALIFIED", value: "5000.00", archivedAt: new Date() });
      leadIds = [activeQualified.id, archivedQualified.id];

      const snapshot = await getLeadPipelineSnapshot(fixtures.orgA.id);
      const qualifiedCount = snapshot.stages.find((s) => s.stage === "QUALIFIED")!.count;
      expect(qualifiedCount).toBe(1);
      expect(snapshot.activePipelineValue).toBe(1000);
    });

    it("activePipelineValue excludes WON and LOST stages, even when active (non-archived)", async () => {
      const won = await createExtraLead({ organizationId: fixtures.orgA.id, stage: "WON", value: "2000.00" });
      const lost = await createExtraLead({ organizationId: fixtures.orgA.id, stage: "LOST", value: "3000.00" });
      const active = await createExtraLead({ organizationId: fixtures.orgA.id, stage: "PROPOSAL", value: "400.00" });
      leadIds = [won.id, lost.id, active.id];

      const snapshot = await getLeadPipelineSnapshot(fixtures.orgA.id);
      expect(snapshot.activePipelineValue).toBe(400);
    });

    it("cent-exact: two active Leads valued at 0.10 and 0.20 sum to exactly 0.3, not 0.30000000000000004 -- DB-side SUM, converted once, was already exact", async () => {
      const a = await createExtraLead({ organizationId: fixtures.orgA.id, stage: "QUALIFIED", value: "0.10" });
      const b = await createExtraLead({ organizationId: fixtures.orgA.id, stage: "PROPOSAL", value: "0.20" });
      leadIds = [a.id, b.id];

      const snapshot = await getLeadPipelineSnapshot(fixtures.orgA.id);
      expect(snapshot.activePipelineValue).toBe(0.3);
    });

    it("never leaks a foreign tenant's Lead into the snapshot", async () => {
      const foreign = await createExtraLead({ organizationId: fixtures.orgB.id, stage: "QUALIFIED" });
      leadIds = [foreign.id];

      const snapshot = await getLeadPipelineSnapshot(fixtures.orgA.id);
      const qualifiedCount = snapshot.stages.find((s) => s.stage === "QUALIFIED")!.count;
      expect(qualifiedCount).toBe(0);
    });
  });
});
