import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { buildInvoiceWhere, buildInvoiceOrderBy } from "@/app/(dashboard)/invoices/query";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Aqenra Invoice UX — Client/Project Links. The Staff Invoice list page
 * (src/app/(dashboard)/invoices/page.tsx) builds each row's Client/
 * Project link href directly from the returned row's own `clientId`/
 * `projectId` scalar columns — never from any second, separately-scoped
 * lookup. This proves that guarantee at the data layer: the exact
 * `buildInvoiceWhere(organizationId, ...)` clause the page itself uses
 * only ever returns rows (and therefore only ever produces link targets)
 * scoped to that one organization, so a foreign organization's Client/
 * Project id can never appear as a link target on another org's page
 * render — matching every other buildInvoiceWhere org-scoping proof
 * already established (see test/integration/invoices/staff-reads-
 * project-less.test.ts).
 */
describe("Invoice list Client/Project link targets stay org-scoped (Aqenra Invoice UX)", () => {
  let fixtures: TestFixtures;
  let orgAInvoice: { id: string; clientId: string; projectId: string | null };
  let orgBInvoice: { id: string; clientId: string; projectId: string | null };

  beforeAll(async () => {
    fixtures = await seedTestData();
    const suffix = randomUUID().slice(0, 8);

    orgAInvoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `LINK-ORGA-${suffix}`,
        status: "SENT",
        amount: "120.00",
        subtotal: "120.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        clientId: fixtures.clientA.id,
        projectId: fixtures.project.id,
        organizationId: fixtures.orgA.id,
        issueDate: new Date(),
      },
    });

    orgBInvoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `LINK-ORGB-${suffix}`,
        status: "SENT",
        amount: "90.00",
        subtotal: "90.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        clientId: fixtures.clientB.id,
        projectId: null,
        organizationId: fixtures.orgB.id,
        issueDate: new Date(),
      },
    });
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({ where: { id: { in: [orgAInvoice.id, orgBInvoice.id] } } });
    await cleanupTestData(fixtures);
  });

  it("4. an org-scoped list query returns the exact clientId/projectId the page links to", async () => {
    const where = buildInvoiceWhere(fixtures.orgA.id, { q: "", status: undefined });
    const found = await prisma.invoice.findFirst({
      where: { ...where, id: orgAInvoice.id },
      include: { client: { select: { id: true, name: true } }, project: { select: { id: true, name: true } } },
    });
    expect(found).not.toBeNull();
    expect(found?.clientId).toBe(fixtures.clientA.id);
    expect(found?.client.id).toBe(fixtures.clientA.id);
    expect(found?.projectId).toBe(fixtures.project.id);
    expect(found?.project?.id).toBe(fixtures.project.id);
  });

  it("5. org A's list query never returns org B's invoice, so org B's Client/Project ids can never surface as a link target on org A's page", async () => {
    const where = buildInvoiceWhere(fixtures.orgA.id, { q: "", status: undefined });
    const rows = await prisma.invoice.findMany({
      where,
      orderBy: buildInvoiceOrderBy({ sortField: "createdAt", sortDir: "desc" }),
      include: { client: { select: { id: true, name: true } }, project: { select: { id: true, name: true } } },
    });

    expect(rows.some((r) => r.id === orgBInvoice.id)).toBe(false);
    expect(rows.every((r) => r.clientId !== fixtures.clientB.id)).toBe(true);
    expect(rows.every((r) => r.client.id !== fixtures.clientB.id)).toBe(true);
  });

  it("5. org B's own list query, symmetrically, never returns org A's invoice or client/project ids", async () => {
    const where = buildInvoiceWhere(fixtures.orgB.id, { q: "", status: undefined });
    const rows = await prisma.invoice.findMany({
      where,
      orderBy: buildInvoiceOrderBy({ sortField: "createdAt", sortDir: "desc" }),
      include: { client: { select: { id: true, name: true } }, project: { select: { id: true, name: true } } },
    });

    expect(rows.some((r) => r.id === orgAInvoice.id)).toBe(false);
    expect(rows.every((r) => r.clientId !== fixtures.clientA.id)).toBe(true);
  });
});
