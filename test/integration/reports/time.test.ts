import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getTrackedMinutes, getTimeByClient } from "@/lib/reports/queries/time";
import { getReportsPeriodRange } from "@/lib/reports/period";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { createExtraClient, createExtraProject, createExtraTimeEntry, cleanupExtraReportsData } from "./helpers";

const NOW = new Date("2026-06-15T12:00:00.000Z");
const RANGE = getReportsPeriodRange("this_month", NOW); // 2026-06-01T00:00Z .. 2026-07-01T00:00Z (exclusive)

describe("Reports Time queries", () => {
  let fixtures: TestFixtures;
  let timeEntryIds: string[];
  let projectIds: string[];
  let clientIds: string[];

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    await cleanupExtraReportsData({ timeEntryIds, projectIds, clientIds });
    timeEntryIds = [];
    projectIds = [];
    clientIds = [];
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  describe("getTrackedMinutes", () => {
    it("sums durationMinutes for non-archived entries within the range", async () => {
      const a = await createExtraTimeEntry({ organizationId: fixtures.orgA.id, durationMinutes: 60, workDate: new Date("2026-06-10T00:00:00.000Z") });
      const b = await createExtraTimeEntry({ organizationId: fixtures.orgA.id, durationMinutes: 30, workDate: new Date("2026-06-11T00:00:00.000Z") });
      timeEntryIds = [a.id, b.id];

      expect(await getTrackedMinutes(fixtures.orgA.id, RANGE)).toBe(90);
    });

    it("excludes archived entries", async () => {
      const active = await createExtraTimeEntry({ organizationId: fixtures.orgA.id, durationMinutes: 60, workDate: new Date("2026-06-10T00:00:00.000Z") });
      const archived = await createExtraTimeEntry({ organizationId: fixtures.orgA.id, durationMinutes: 999, workDate: new Date("2026-06-10T00:00:00.000Z"), archivedAt: new Date() });
      timeEntryIds = [active.id, archived.id];

      expect(await getTrackedMinutes(fixtures.orgA.id, RANGE)).toBe(60);
    });

    it("entries with no Project still count toward the total tracked KPI", async () => {
      const noProject = await createExtraTimeEntry({ organizationId: fixtures.orgA.id, durationMinutes: 45, workDate: new Date("2026-06-10T00:00:00.000Z"), projectId: null });
      timeEntryIds = [noProject.id];

      expect(await getTrackedMinutes(fixtures.orgA.id, RANGE)).toBe(45);
    });

    it("workDate boundaries are exact: included at range.start, excluded at range.end", async () => {
      const atStart = await createExtraTimeEntry({ organizationId: fixtures.orgA.id, durationMinutes: 10, workDate: RANGE.start });
      const atEnd = await createExtraTimeEntry({ organizationId: fixtures.orgA.id, durationMinutes: 20, workDate: RANGE.end });
      timeEntryIds = [atStart.id, atEnd.id];

      expect(await getTrackedMinutes(fixtures.orgA.id, RANGE)).toBe(10);
    });

    it("never leaks a foreign tenant's tracked time", async () => {
      const foreign = await createExtraTimeEntry({ organizationId: fixtures.orgB.id, durationMinutes: 500, workDate: new Date("2026-06-10T00:00:00.000Z") });
      timeEntryIds = [foreign.id];

      expect(await getTrackedMinutes(fixtures.orgA.id, RANGE)).toBe(0);
    });
  });

  describe("getTimeByClient", () => {
    it("aggregates minutes across multiple Projects belonging to the same Client", async () => {
      const client = await createExtraClient(fixtures.orgA.id, fixtures.owner.id, "Reports Time Client");
      const projectOne = await createExtraProject(fixtures.orgA.id, client.id, fixtures.owner.id, "Reports Time Project 1");
      const projectTwo = await createExtraProject(fixtures.orgA.id, client.id, fixtures.owner.id, "Reports Time Project 2");
      clientIds = [client.id];
      projectIds = [projectOne.id, projectTwo.id];

      const e1 = await createExtraTimeEntry({ organizationId: fixtures.orgA.id, projectId: projectOne.id, durationMinutes: 40, workDate: new Date("2026-06-05T00:00:00.000Z") });
      const e2 = await createExtraTimeEntry({ organizationId: fixtures.orgA.id, projectId: projectTwo.id, durationMinutes: 25, workDate: new Date("2026-06-06T00:00:00.000Z") });
      timeEntryIds = [e1.id, e2.id];

      const result = await getTimeByClient(fixtures.orgA.id, RANGE);
      const row = result.find((r) => r.clientId === client.id)!;
      expect(row.totalMinutes).toBe(65);
      expect(row.clientName).toBe("Reports Time Client");
    });

    it("excludes entries with no Project link entirely -- they never appear as any Client's time here", async () => {
      const noProject = await createExtraTimeEntry({ organizationId: fixtures.orgA.id, projectId: null, durationMinutes: 999, workDate: new Date("2026-06-05T00:00:00.000Z") });
      timeEntryIds = [noProject.id];

      const result = await getTimeByClient(fixtures.orgA.id, RANGE);
      const totalAcrossAllClients = result.reduce((sum, r) => sum + r.totalMinutes, 0);
      expect(totalAcrossAllClients).toBe(0);
    });

    it("this deliberate gap between Tracked hours (includes unassigned time) and Time by Client (excludes it) is real, not a bug", async () => {
      const client = await createExtraClient(fixtures.orgA.id, fixtures.owner.id, "Reports Partial Client");
      const project = await createExtraProject(fixtures.orgA.id, client.id, fixtures.owner.id, "Reports Partial Project");
      clientIds = [client.id];
      projectIds = [project.id];

      const assigned = await createExtraTimeEntry({ organizationId: fixtures.orgA.id, projectId: project.id, durationMinutes: 30, workDate: new Date("2026-06-05T00:00:00.000Z") });
      const unassigned = await createExtraTimeEntry({ organizationId: fixtures.orgA.id, projectId: null, durationMinutes: 20, workDate: new Date("2026-06-05T00:00:00.000Z") });
      timeEntryIds = [assigned.id, unassigned.id];

      const totalTracked = await getTrackedMinutes(fixtures.orgA.id, RANGE);
      const byClient = await getTimeByClient(fixtures.orgA.id, RANGE);
      const clientTotal = byClient.reduce((sum, r) => sum + r.totalMinutes, 0);

      expect(totalTracked).toBe(50); // includes the unassigned 20
      expect(clientTotal).toBe(30); // excludes it
    });

    it("never leaks a foreign tenant's time-by-client data", async () => {
      const projectB = await createExtraProject(fixtures.orgB.id, fixtures.clientB.id, fixtures.orgBOwner.id, "Reports Foreign Project");
      projectIds = [projectB.id];
      const entry = await createExtraTimeEntry({ organizationId: fixtures.orgB.id, projectId: projectB.id, durationMinutes: 500, workDate: new Date("2026-06-05T00:00:00.000Z") });
      timeEntryIds = [entry.id];

      const result = await getTimeByClient(fixtures.orgA.id, RANGE);
      expect(result.find((r) => r.clientId === fixtures.clientB.id)).toBeUndefined();
    });
  });
});
