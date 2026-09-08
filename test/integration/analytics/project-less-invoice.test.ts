import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getOrganizationMetrics } from "@/lib/analytics/queries/organization-metrics";
import { getInvoiceCompletionCounts } from "@/lib/analytics/queries/completion-metrics";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Quotes / Estimates Phase 2.3 — confirms the Analytics module (already
 * organization/client-scoped and null-safe — see the Invoice / Project
 * Coupling Audit's own finding) needed no code change, and remains
 * correct for a project-less Invoice. §N.
 */
describe("Analytics — project-less Invoice inclusion (Quotes / Estimates Phase 2.3)", () => {
  let fixtures: TestFixtures;
  const createdInvoiceIds: string[] = [];

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({ where: { id: { in: createdInvoiceIds } } });
    await cleanupTestData(fixtures);
  });

  it("getOrganizationMetrics.totalInvoices counts a newly-created project-less invoice", async () => {
    const before = await getOrganizationMetrics(prisma, fixtures.orgA.id);

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `P23-ANALYTICS-${randomUUID().slice(0, 8)}`,
        status: "DRAFT",
        amount: "200.00",
        subtotal: "200.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        clientId: fixtures.clientA.id,
        projectId: null,
        organizationId: fixtures.orgA.id,
        issueDate: new Date(),
      },
    });
    createdInvoiceIds.push(invoice.id);

    const after = await getOrganizationMetrics(prisma, fixtures.orgA.id);
    expect(after.totalInvoices).toBe(before.totalInvoices + 1);
  });

  it("getInvoiceCompletionCounts counts a newly-created project-less PAID invoice", async () => {
    const before = await getInvoiceCompletionCounts(prisma, fixtures.orgA.id);

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `P23-ANALYTICS-${randomUUID().slice(0, 8)}`,
        status: "PAID",
        amount: "200.00",
        subtotal: "200.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        clientId: fixtures.clientA.id,
        projectId: null,
        organizationId: fixtures.orgA.id,
        issueDate: new Date(),
        paidAt: new Date(),
      },
    });
    createdInvoiceIds.push(invoice.id);

    const after = await getInvoiceCompletionCounts(prisma, fixtures.orgA.id);
    expect(after.paidInvoices).toBe(before.paidInvoices + 1);
  });
});
