import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { buildInvoiceWhere, buildInvoiceOrderBy } from "@/app/(dashboard)/invoices/query";
import { searchInvoices } from "@/lib/search/search-invoices";
import { executeSearchInvoices } from "@/lib/ai/tools/invoices";
import { getDuplicateSourceInvoice } from "@/lib/invoices/duplicate-source";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Quotes / Estimates Phase 2.3 — every staff read surface must include a
 * project-less Invoice, not silently exclude it. §AB items 15-19
 * (list/search/AI already have dedicated behavior tests in
 * create-edit-project-optional.test.ts for the write side; this file
 * proves the read side directly against real seeded data).
 */
describe("Staff Invoice reads — project-less Invoice visibility (Quotes / Estimates Phase 2.3)", () => {
  let fixtures: TestFixtures;
  let projectLessInvoice: { id: string; invoiceNumber: string };
  let cancelledProjectLessInvoice: { id: string; invoiceNumber: string };

  beforeAll(async () => {
    fixtures = await seedTestData();
    const suffix = randomUUID().slice(0, 8);
    projectLessInvoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `P23-STAFFREAD-${suffix}`,
        status: "SENT",
        amount: "175.00",
        subtotal: "175.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        clientId: fixtures.clientA.id,
        projectId: null,
        organizationId: fixtures.orgA.id,
        issueDate: new Date(),
      },
    });
    cancelledProjectLessInvoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `P23-STAFFREAD-CANCELLED-${suffix}`,
        status: "CANCELLED",
        amount: "50.00",
        subtotal: "50.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        clientId: fixtures.clientA.id,
        projectId: null,
        organizationId: fixtures.orgA.id,
        issueDate: new Date(),
      },
    });
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({ where: { id: { in: [projectLessInvoice.id, cancelledProjectLessInvoice.id] } } });
    await cleanupTestData(fixtures);
  });

  it("15. buildInvoiceWhere's own where clause matches a project-less Invoice for its organization", async () => {
    const where = buildInvoiceWhere(fixtures.orgA.id, { q: "", status: undefined });
    const found = await prisma.invoice.findFirst({ where: { ...where, id: projectLessInvoice.id } });
    expect(found).not.toBeNull();
  });

  it("15. the search term also matches Client name directly (Invoice.client, never routed through Project)", async () => {
    const where = buildInvoiceWhere(fixtures.orgA.id, { q: fixtures.clientA.name, status: undefined });
    const found = await prisma.invoice.findFirst({
      where: { ...where, id: projectLessInvoice.id },
      orderBy: buildInvoiceOrderBy({ sortField: "createdAt", sortDir: "desc" }),
    });
    expect(found).not.toBeNull();
  });

  it("17. duplicate flow: a project-less CANCELLED source Invoice is a valid duplicate source", async () => {
    const source = await getDuplicateSourceInvoice(cancelledProjectLessInvoice.id, fixtures.orgA.id);
    expect(source).not.toBeNull();
    expect(source?.projectId).toBeNull();
    expect(source?.clientId).toBe(fixtures.clientA.id);
  });

  it("18. Global Search finds a project-less Invoice by invoice number", async () => {
    const result = await searchInvoices({
      organizationId: fixtures.orgA.id,
      query: projectLessInvoice.invoiceNumber,
      candidateLimit: 20,
      resultLimit: 10,
    });
    expect(result.some((r) => r.id === projectLessInvoice.id)).toBe(true);
  });

  it("19. the AI assistant invoice tool sees a project-less Invoice, with projectName null", async () => {
    const result = await executeSearchInvoices(fixtures.orgA.id, { query: projectLessInvoice.invoiceNumber });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const hit = result.results.find((r) => r.invoiceNumber === projectLessInvoice.invoiceNumber);
    expect(hit).toBeDefined();
    expect(hit?.projectName).toBeNull();
    expect(hit?.clientName).toBe(fixtures.clientA.name);
  });
});
