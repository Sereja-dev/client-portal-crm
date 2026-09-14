import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getNewClientsCount } from "@/lib/reports/queries/clients";
import { getReportsPeriodRange } from "@/lib/reports/period";
import { getReportsOverview } from "@/lib/reports/service";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { resetNavigationMock } from "../../support/navigation-mock";
import { createExtraInvoice, cleanupExtraReportsData } from "./helpers";

const NOW = new Date("2026-06-15T12:00:00.000Z");
const RANGE = getReportsPeriodRange("this_month", NOW);

describe("getNewClientsCount", () => {
  let fixtures: TestFixtures;
  let clientIds: string[];

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    if (clientIds?.length) {
      await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
    }
    clientIds = [];
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("counts Clients created within the range", async () => {
    const inside = await prisma.client.create({
      data: { name: "Reports New Client", organizationId: fixtures.orgA.id, userId: fixtures.owner.id, createdAt: new Date("2026-06-10T00:00:00.000Z") },
    });
    const outside = await prisma.client.create({
      data: { name: "Reports Old Client", organizationId: fixtures.orgA.id, userId: fixtures.owner.id, createdAt: new Date("2026-01-01T00:00:00.000Z") },
    });
    clientIds = [inside.id, outside.id];

    expect(await getNewClientsCount(fixtures.orgA.id, RANGE)).toBe(1);
  });

  it("a legacy Client row with a null organizationId is never counted for any organization", async () => {
    const legacy = await prisma.client.create({
      data: { name: "Reports Legacy Null-Org Client", organizationId: null, userId: fixtures.owner.id, createdAt: new Date("2026-06-10T00:00:00.000Z") },
    });
    clientIds = [legacy.id];

    expect(await getNewClientsCount(fixtures.orgA.id, RANGE)).toBe(0);
    expect(await getNewClientsCount(fixtures.orgB.id, RANGE)).toBe(0);
  });

  it("never leaks a foreign tenant's new Client", async () => {
    const foreign = await prisma.client.create({
      data: { name: "Reports Foreign Client", organizationId: fixtures.orgB.id, userId: fixtures.orgBOwner.id, createdAt: new Date("2026-06-10T00:00:00.000Z") },
    });
    clientIds = [foreign.id];

    expect(await getNewClientsCount(fixtures.orgA.id, RANGE)).toBe(0);
  });
});

describe("getReportsOverview — end-to-end wiring", () => {
  let fixtures: TestFixtures;
  let invoiceIds: string[];

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(async () => {
    await cleanupExtraReportsData({ invoiceIds });
    invoiceIds = [];
    resetAuthMock();
    resetNavigationMock();
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("defaults to the 30d period and a real currency selection when nothing is requested", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await getReportsOverview();
    expect(result.period).toBe("30d");
    expect(result.currency.selectedCurrency).toBe("USD");
    expect(result.organizationId).toBe(fixtures.orgA.id);
  });

  it("an invalid requested period falls back safely instead of throwing", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await getReportsOverview({ requestedPeriod: "bogus-value" });
    expect(result.period).toBe("30d");
  });

  it("a forged requested currency never propagates into any financial figure", async () => {
    const paid = await createExtraInvoice({
      organizationId: fixtures.orgA.id,
      clientId: fixtures.clientA.id,
      amount: "250.00",
      currency: "USD",
      status: "PAID",
      paidAt: new Date("2026-06-10T00:00:00.000Z"),
    });
    invoiceIds = [paid.id];

    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await getReportsOverview({ requestedPeriod: "this_month", requestedCurrency: "ZZZ", now: NOW });
    expect(result.currency.selectedCurrency).toBe("USD"); // forged code rejected, safe fallback used
    expect(result.overview.paidRevenue).toBeGreaterThanOrEqual(250);
  });

  it("range is half-open [start, end) and matches the requested period exactly", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await getReportsOverview({ requestedPeriod: "this_month", now: NOW });
    expect(result.range.start.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(result.range.end.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("every overview KPI and section key is present in the returned view model, with no deferred-metric field leaking in", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const result = await getReportsOverview({ now: NOW });

    expect(Object.keys(result.overview).sort()).toEqual(
      ["paidRevenue", "outstandingNow", "newLeads", "convertedLeads", "newClients", "trackedMinutes"].sort(),
    );
    expect(Object.keys(result.sections).sort()).toEqual(["revenueTrend", "leadPipeline", "topClients", "timeByClient"].sort());
  });

  it("outstandingNow reflects the current snapshot regardless of the selected period", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const shortPeriod = await getReportsOverview({ requestedPeriod: "7d", now: NOW });
    const longPeriod = await getReportsOverview({ requestedPeriod: "this_year", now: NOW });
    // The fixture's own 500.00 DRAFT invoice is outstanding regardless of
    // which period is selected -- outstandingNow must not vary with it.
    expect(shortPeriod.overview.outstandingNow).toBe(longPeriod.overview.outstandingNow);
  });

  it("leadPipeline is a current snapshot: identical across two different periods for the same organization at the same instant", async () => {
    actAs(fixtures.owner, fixtures.orgA.id);
    const a = await getReportsOverview({ requestedPeriod: "7d", now: NOW });
    const b = await getReportsOverview({ requestedPeriod: "this_quarter", now: NOW });
    expect(a.sections.leadPipeline).toEqual(b.sections.leadPipeline);
  });
});
