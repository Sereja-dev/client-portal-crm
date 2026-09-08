import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getPortalInvoice, getPortalInvoices, getPortalOverview } from "@/lib/client-portal/queries";
import { getPortalInvoiceAttachments, verifyPortalAttachmentAccess } from "@/lib/client-portal/attachments";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";

/**
 * Quotes / Estimates Phase 2.3 — Client Portal support for a
 * project-less Invoice (projectId: null). Authorization throughout the
 * Portal is clientId + organizationId (Invoice's own column) — never
 * derived from Project, which may not exist at all for these rows. §AB
 * PORTAL items 20-26.
 */
describe("Client Portal — project-less Invoice (Quotes / Estimates Phase 2.3)", () => {
  let fixtures: TestFixtures;
  let projectLessInvoice: { id: string; invoiceNumber: string };

  beforeAll(async () => {
    fixtures = await seedTestData();
    projectLessInvoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `PORTAL-P23-${randomUUID().slice(0, 8)}`,
        status: "SENT",
        amount: "450.00",
        subtotal: "450.00",
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
    await prisma.invoice.deleteMany({ where: { id: projectLessInvoice.id } });
    await cleanupTestData(fixtures);
  });

  it("20. appears in the own-Client Portal invoice list, with projectName null", async () => {
    const results = await getPortalInvoices(fixtures.clientA.id, fixtures.orgA.id, "all");
    const found = results.find((r) => r.id === projectLessInvoice.id);
    expect(found).toBeDefined();
    expect(found?.projectName).toBeNull();
  });

  it("21. detail view works — clientName present, projectName null, organizationId correct", async () => {
    const detail = await getPortalInvoice(fixtures.clientA.id, fixtures.orgA.id, projectLessInvoice.id);
    expect(detail).not.toBeNull();
    expect(detail?.projectName).toBeNull();
    expect(detail?.clientName).toBe(fixtures.clientA.name);
    expect(detail?.organizationId).toBe(fixtures.orgA.id);
  });

  it("22. a foreign Client (even same organization) is blocked from the project-less Invoice's detail — no IDOR", async () => {
    const otherClient = await prisma.client.create({
      data: { name: "Portal Other Client", organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
    });
    try {
      const detail = await getPortalInvoice(otherClient.id, fixtures.orgA.id, projectLessInvoice.id);
      expect(detail).toBeNull();
    } finally {
      await prisma.client.deleteMany({ where: { id: otherClient.id } });
    }
  });

  it("counted in getPortalOverview's open invoices / outstanding amount, and appears in recentInvoices", async () => {
    const overview = await getPortalOverview(fixtures.clientA.id, fixtures.orgA.id);
    expect(overview.openInvoicesCount).toBeGreaterThan(0);
    expect(overview.outstandingAmount).toBeGreaterThanOrEqual(450);
    expect(overview.recentInvoices.some((r) => r.id === projectLessInvoice.id)).toBe(true);
  });

  it("25. Portal attachment listing (getPortalInvoiceAttachments) works using Invoice.organizationId directly", async () => {
    const attachment = await prisma.attachment.create({
      data: {
        organizationId: fixtures.orgA.id,
        entityType: "INVOICE",
        entityId: projectLessInvoice.id,
        storageBucket: "attachments",
        storagePath: `organizations/${fixtures.orgA.id}/INVOICE/${projectLessInvoice.id}/${randomUUID()}/file.pdf`,
        originalName: "file.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
      },
    });
    try {
      const list = await getPortalInvoiceAttachments({
        id: projectLessInvoice.id,
        invoiceNumber: projectLessInvoice.invoiceNumber,
        organizationId: fixtures.orgA.id,
      });
      expect(list).toHaveLength(1);
      expect(list[0].parentLabel).toBe(projectLessInvoice.invoiceNumber);
    } finally {
      await prisma.attachment.deleteMany({ where: { id: attachment.id } });
    }
  });

  it("23 & 24 & 26. verifyPortalAttachmentAccess allows the owning Client and blocks a foreign Client — no IDOR for a project-less Invoice's attachment", async () => {
    const attachment = await prisma.attachment.create({
      data: {
        organizationId: fixtures.orgA.id,
        entityType: "INVOICE",
        entityId: projectLessInvoice.id,
        storageBucket: "attachments",
        storagePath: `organizations/${fixtures.orgA.id}/INVOICE/${projectLessInvoice.id}/${randomUUID()}/file.pdf`,
        originalName: "file.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
      },
      select: { entityType: true, entityId: true, organizationId: true, id: true },
    });
    try {
      const allowed = await verifyPortalAttachmentAccess(attachment, { clientId: fixtures.clientA.id, organizationId: fixtures.orgA.id });
      expect(allowed).toBe(true);

      const foreignSameOrg = await verifyPortalAttachmentAccess(attachment, {
        clientId: randomUUID(), // a nonexistent/foreign Client id in the same org
        organizationId: fixtures.orgA.id,
      });
      expect(foreignSameOrg).toBe(false);

      const foreignOrg = await verifyPortalAttachmentAccess(attachment, { clientId: fixtures.clientB.id, organizationId: fixtures.orgB.id });
      expect(foreignOrg).toBe(false);
    } finally {
      await prisma.attachment.deleteMany({ where: { id: attachment.id } });
    }
  });
});
