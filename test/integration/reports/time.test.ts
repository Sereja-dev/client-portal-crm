import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
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

    it("tenant hardening: a corrupted TimeEntry (organizationId = org A, but pointing at org B's own Project) never surfaces org B's Client in org A's Time-by-Client -- and its minutes are excluded from this table, though still counted in the overall Tracked Minutes KPI", async () => {
      // Deliberately bypasses the domain layer's own write-time org-match
      // guarantee (src/lib/time-entries/entries.ts) -- exactly the
      // "corrupted or future-invalid cross-tenant relation" scenario the
      // Phase 1 hardening review flagged: nothing at the database level
      // ties TimeEntry.projectId to a same-org Project, so this row is a
      // real, constructible (if never legitimately produced) state.
      const projectB = await createExtraProject(fixtures.orgB.id, fixtures.clientB.id, fixtures.orgBOwner.id, "Reports Corrupt Cross-Org Project");
      projectIds = [projectB.id];
      const corrupted = await createExtraTimeEntry({
        organizationId: fixtures.orgA.id, // org A's own TimeEntry...
        projectId: projectB.id, // ...pointing at org B's own Project
        durationMinutes: 500,
        workDate: new Date("2026-06-05T00:00:00.000Z"),
      });
      timeEntryIds = [corrupted.id];

      const byClient = await getTimeByClient(fixtures.orgA.id, RANGE);
      expect(byClient.find((r) => r.clientId === fixtures.clientB.id)).toBeUndefined();
      expect(byClient.reduce((sum, r) => sum + r.totalMinutes, 0)).toBe(0);

      // The TimeEntry row itself is genuinely org A's own (its own
      // organizationId column says so) -- Tracked Minutes, scoped purely
      // by that reliable column, still counts it.
      expect(await getTrackedMinutes(fixtures.orgA.id, RANGE)).toBe(500);
    });

    it("tenant hardening: a legacy Project with a null organizationId is never surfaced in Time-by-Client, even though a real org A TimeEntry points at it", async () => {
      const legacyProject = await prisma.project.create({
        data: {
          name: "Reports Legacy Null-Org Project",
          clientId: fixtures.clientA.id,
          organizationId: null,
          ownerId: fixtures.owner.id,
          status: "IN_PROGRESS",
        },
      });
      projectIds = [legacyProject.id];
      const entry = await createExtraTimeEntry({
        organizationId: fixtures.orgA.id,
        projectId: legacyProject.id,
        durationMinutes: 240,
        workDate: new Date("2026-06-05T00:00:00.000Z"),
      });
      timeEntryIds = [entry.id];

      const byClient = await getTimeByClient(fixtures.orgA.id, RANGE);
      expect(byClient.find((r) => r.clientId === fixtures.clientA.id && r.totalMinutes > 0)).toBeUndefined();
      expect(byClient.reduce((sum, r) => sum + r.totalMinutes, 0)).toBe(0);

      // Still a real org A TimeEntry -- still counted in the overall KPI.
      expect(await getTrackedMinutes(fixtures.orgA.id, RANGE)).toBe(240);
    });

    it("tenant hardening: a legacy Client with a null organizationId is never surfaced in Time-by-Client, even when its Project has a real organizationId", async () => {
      const legacyClient = await prisma.client.create({
        data: { name: "Reports Legacy Null-Org Client", organizationId: null, userId: fixtures.owner.id },
      });
      clientIds = [legacyClient.id];
      const projectOnLegacyClient = await prisma.project.create({
        data: {
          name: "Reports Project On Legacy Client",
          clientId: legacyClient.id,
          organizationId: fixtures.orgA.id, // the Project itself claims org A...
          ownerId: fixtures.owner.id,
          status: "IN_PROGRESS",
        },
      });
      projectIds = [projectOnLegacyClient.id];
      const entry = await createExtraTimeEntry({
        organizationId: fixtures.orgA.id,
        projectId: projectOnLegacyClient.id,
        durationMinutes: 90,
        workDate: new Date("2026-06-05T00:00:00.000Z"),
      });
      timeEntryIds = [entry.id];

      // ...but its Client does not -- the relation filter on `client`
      // requires both sides to match, so this Project is excluded too.
      const byClient = await getTimeByClient(fixtures.orgA.id, RANGE);
      expect(byClient.find((r) => r.clientId === legacyClient.id)).toBeUndefined();
      expect(byClient.reduce((sum, r) => sum + r.totalMinutes, 0)).toBe(0);
      expect(await getTrackedMinutes(fixtures.orgA.id, RANGE)).toBe(90);
    });
  });
});
