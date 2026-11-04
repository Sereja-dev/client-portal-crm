import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getPortalOverview } from "@/lib/client-portal/queries";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * The Portal overview's outstanding amounts are grouped by each invoice's own
 * currency: never added across currencies, never defaulted to USD. Every case
 * below uses its own freshly created Client so counts and totals are exact and
 * independent of the shared fixture invoices.
 */

let fixtures: TestFixtures;
const clientIds: string[] = [];
const invoiceIds: string[] = [];

async function makeClient(name: string, organizationId = fixtures.orgA.id): Promise<string> {
  const client = await prisma.client.create({ data: { name: `${name} ${randomUUID().slice(0, 6)}`, organizationId, userId: fixtures.owner.id } });
  clientIds.push(client.id);
  return client.id;
}

async function makeInvoice(clientId: string, amount: string, currency: string, status: "DRAFT" | "SENT" | "OVERDUE" | "PAID" | "CANCELLED", organizationId = fixtures.orgA.id) {
  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber: `OBC-${randomUUID().slice(0, 10)}`,
      clientId,
      organizationId,
      amount,
      currency,
      status,
      issueDate: new Date(),
      ...(status === "PAID" ? { paidAt: new Date() } : {}),
    },
  });
  invoiceIds.push(invoice.id);
}

beforeAll(async () => {
  fixtures = await seedTestData();
});

afterAll(async () => {
  await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
  await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
  await cleanupTestData(fixtures);
});

describe("getPortalOverview — outstanding totals by currency", () => {
  it("no open invoices: no currency totals and a zero count, even with non-open invoices present", async () => {
    const clientId = await makeClient("OBC none");
    await makeInvoice(clientId, "999.00", "GBP", "DRAFT");
    await makeInvoice(clientId, "888.00", "USD", "PAID");
    await makeInvoice(clientId, "777.00", "EUR", "CANCELLED");

    const overview = await getPortalOverview(clientId, fixtures.orgA.id);

    expect(overview.outstandingByCurrency).toEqual([]);
    expect(overview.openInvoicesCount).toBe(0);
  });

  it("one non-USD currency: EUR 10.10 + EUR 20.20 is exactly EUR 30.30, with no USD entry", async () => {
    const clientId = await makeClient("OBC eur");
    await makeInvoice(clientId, "10.10", "EUR", "SENT");
    await makeInvoice(clientId, "20.20", "EUR", "OVERDUE");

    const overview = await getPortalOverview(clientId, fixtures.orgA.id);

    expect(overview.outstandingByCurrency).toEqual([{ currency: "EUR", amount: 30.3 }]);
    // Cent-exact: a floating-point JS sum of 10.10 + 20.20 would be 30.299999999999997.
    expect(Math.round(overview.outstandingByCurrency[0].amount * 100)).toBe(3030);
    expect(overview.outstandingByCurrency[0].amount).toBe(30.3);
    expect(overview.openInvoicesCount).toBe(2);
  });

  it("multiple currencies stay separate (EUR 30.30 and USD 100.10), ordered by code, and the count covers all of them", async () => {
    const clientId = await makeClient("OBC mixed");
    await makeInvoice(clientId, "100.10", "USD", "SENT");
    await makeInvoice(clientId, "10.10", "EUR", "SENT");
    await makeInvoice(clientId, "20.20", "EUR", "OVERDUE");

    const overview = await getPortalOverview(clientId, fixtures.orgA.id);

    expect(overview.outstandingByCurrency).toEqual([
      { currency: "EUR", amount: 30.3 },
      { currency: "USD", amount: 100.1 },
    ]);
    expect(overview.openInvoicesCount).toBe(3);
    // The old behavior added unlike currencies into one figure.
    expect(overview.outstandingByCurrency.some((total) => total.amount === 130.4)).toBe(false);
  });

  it("currencies that share a symbol are separate entries identified by code, in alphabetical order", async () => {
    const clientId = await makeClient("OBC symbols");
    await makeInvoice(clientId, "10.00", "USD", "SENT");
    await makeInvoice(clientId, "10.00", "CAD", "SENT");
    await makeInvoice(clientId, "10.00", "AUD", "SENT");

    const overview = await getPortalOverview(clientId, fixtures.orgA.id);

    expect(overview.outstandingByCurrency.map((total) => total.currency)).toEqual(["AUD", "CAD", "USD"]);
    expect(overview.openInvoicesCount).toBe(3);
  });

  it("other clients, other organizations and non-open statuses never affect the totals or the count", async () => {
    const clientId = await makeClient("OBC isolation");
    await makeInvoice(clientId, "30.30", "EUR", "SENT");
    // noise that must not count
    await makeInvoice(clientId, "999.00", "GBP", "DRAFT");
    await makeInvoice(clientId, "888.00", "GBP", "PAID");
    await makeInvoice(clientId, "777.00", "GBP", "CANCELLED");
    const otherClientSameOrg = await makeClient("OBC other client");
    await makeInvoice(otherClientSameOrg, "4000.00", "USD", "SENT");
    const foreignClient = await makeClient("OBC foreign", fixtures.orgB.id);
    await makeInvoice(foreignClient, "5000.00", "USD", "SENT", fixtures.orgB.id);

    const overview = await getPortalOverview(clientId, fixtures.orgA.id);

    expect(overview.outstandingByCurrency).toEqual([{ currency: "EUR", amount: 30.3 }]);
    expect(overview.openInvoicesCount).toBe(1);

    // The organization filter still applies: the same client id under another organization sees nothing.
    const wrongOrganization = await getPortalOverview(clientId, fixtures.orgB.id);
    expect(wrongOrganization.outstandingByCurrency).toEqual([]);
    expect(wrongOrganization.openInvoicesCount).toBe(0);
  });
});
