import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { deleteProjectAction } from "@/app/(dashboard)/projects/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { resetStorageMock, removedPaths } from "../../support/storage-mock";

/**
 * Post-Hardening Residual Code Audit (P2) — deleteProjectAction's own
 * sibling to test/integration/clients/delete.test.ts.
 *
 * Quotes / Estimates Phase 2.4 — Invoice.projectId's own FK became
 * `onDelete: SetNull` (see prisma/schema.prisma's Invoice.projectId
 * comment and migration 20260923090000_set_invoice_project_fk_set_null),
 * so a Project with existing Invoices is no longer a blocked deletion —
 * this file's own former "blocked by existing invoices" describe block
 * and its mocked P2039-restrict-violation scenario are gone: that error
 * shape can no longer occur for Project (deleteProjectAction no longer
 * even calls mapDeleteRestrictError — see that function's own updated
 * header comment in delete-conflict-mapper.ts). The tests below exercise
 * the real FK behavior directly (a genuinely seeded Invoice, a real
 * deleteProjectAction call, no mocking of prisma.$transaction for the
 * success path) rather than simulating it, since there is no longer a
 * rollback-sensitive failure path here to avoid depending on — see that
 * former helper's own removed comment, and test/integration/clients/
 * delete.test.ts's still-current header comment, for why Client's own
 * sibling file still has to mock its blocked case.
 */

const PROJECT_NAME_PREFIX = "DEL-Project";

function uniqueProjectName(): string {
  return `${PROJECT_NAME_PREFIX}-${randomUUID().slice(0, 8)}`;
}

async function createProject(organizationId: string, clientId: string, ownerId: string, name = uniqueProjectName()) {
  return prisma.project.create({ data: { name, organizationId, clientId, ownerId } });
}

function uniqueInvoiceNumber(): string {
  return `DEL-Project-INV-${randomUUID().slice(0, 8)}`;
}

describe("deleteProjectAction (Quotes / Estimates Phase 2.4 — Invoice.project is now onDelete: SetNull)", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(() => {
    resetAuthMock();
    resetStorageMock();
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({ where: { invoiceNumber: { startsWith: "DEL-Project-INV-" } } });
    await prisma.project.deleteMany({ where: { name: { startsWith: PROJECT_NAME_PREFIX } } });
    await cleanupTestData(fixtures);
  });

  it("authorized deletion with no attached invoices succeeds", async () => {
    const project = await createProject(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id);
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await deleteProjectAction(project.id);

    expect(result).toEqual({ ok: true });
    expect(await prisma.project.findUnique({ where: { id: project.id } })).toBeNull();
  });

  it("5. deleting a Project with a DRAFT Invoice succeeds; the Invoice survives with projectId reset to null", async () => {
    const project = await createProject(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id);
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: uniqueInvoiceNumber(),
        status: "DRAFT",
        amount: "125.00",
        subtotal: "125.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        clientId: fixtures.clientA.id,
        projectId: project.id,
        organizationId: fixtures.orgA.id,
        issueDate: new Date(),
      },
    });
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await deleteProjectAction(project.id);

    expect(result).toEqual({ ok: true });
    expect(await prisma.project.findUnique({ where: { id: project.id } })).toBeNull();

    const survived = await prisma.invoice.findUnique({ where: { id: invoice.id } });
    expect(survived).not.toBeNull();
    expect(survived?.projectId).toBeNull();
    expect(survived?.clientId).toBe(fixtures.clientA.id);
    expect(survived?.status).toBe("DRAFT");
    expect(survived?.invoiceNumber).toBe(invoice.invoiceNumber);
  });

  it("6/21. deleting a Project with an ISSUED (SENT) Invoice succeeds; issueDate/pdfStoragePath/invoiceNumber are preserved, only projectId is nulled", async () => {
    const project = await createProject(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id);
    const issueDate = new Date();
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: uniqueInvoiceNumber(),
        status: "SENT",
        amount: "875.00",
        subtotal: "875.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        clientId: fixtures.clientA.id,
        projectId: project.id,
        organizationId: fixtures.orgA.id,
        issueDate,
        pdfStoragePath: `organizations/${fixtures.orgA.id}/invoices/${randomUUID()}.pdf`,
      },
    });
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await deleteProjectAction(project.id);

    expect(result).toEqual({ ok: true });

    const survived = await prisma.invoice.findUnique({ where: { id: invoice.id } });
    expect(survived).not.toBeNull();
    expect(survived?.projectId).toBeNull();
    expect(survived?.status).toBe("SENT");
    expect(survived?.issueDate.getTime()).toBe(issueDate.getTime());
    expect(survived?.pdfStoragePath).toBe(invoice.pdfStoragePath);
  });

  it("7. deleting a Project with multiple Invoices: every one survives, every one's projectId is nulled", async () => {
    const project = await createProject(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id);
    const invoices = await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        prisma.invoice.create({
          data: {
            invoiceNumber: uniqueInvoiceNumber(),
            status: i === 0 ? "DRAFT" : "SENT",
            amount: "50.00",
            subtotal: "50.00",
            discountAmount: "0.00",
            taxAmount: "0.00",
            clientId: fixtures.clientA.id,
            projectId: project.id,
            organizationId: fixtures.orgA.id,
            issueDate: new Date(),
          },
        }),
      ),
    );
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await deleteProjectAction(project.id);

    expect(result).toEqual({ ok: true });
    const survivors = await prisma.invoice.findMany({ where: { id: { in: invoices.map((inv) => inv.id) } } });
    expect(survivors).toHaveLength(3);
    expect(survivors.every((inv) => inv.projectId === null)).toBe(true);
  });

  it("9. deleting a Project with a dependent Invoice writes exactly one Activity row (PROJECT/DELETED) — no synthetic Invoice-side Activity for the automatic SET NULL", async () => {
    const project = await createProject(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id);
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: uniqueInvoiceNumber(),
        status: "DRAFT",
        amount: "60.00",
        subtotal: "60.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        clientId: fixtures.clientA.id,
        projectId: project.id,
        organizationId: fixtures.orgA.id,
        issueDate: new Date(),
      },
    });
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await deleteProjectAction(project.id);
    expect(result).toEqual({ ok: true });

    const projectActivity = await prisma.activity.findMany({ where: { entityId: project.id } });
    expect(projectActivity).toHaveLength(1);
    expect(projectActivity[0].entityType).toBe("PROJECT");
    expect(projectActivity[0].action).toBe("DELETED");

    const invoiceActivity = await prisma.activity.findMany({ where: { entityId: invoice.id } });
    expect(invoiceActivity).toHaveLength(0);
  });

  it("26. deleting a Project still cascades its own Task rows, unaffected by the Invoice FK change", async () => {
    const project = await createProject(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id);
    const task = await prisma.task.create({
      data: { title: "DEL-Project task", projectId: project.id, organizationId: fixtures.orgA.id },
    });
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await deleteProjectAction(project.id);

    expect(result).toEqual({ ok: true });
    expect(await prisma.task.findUnique({ where: { id: task.id } })).toBeNull();
  });

  it("a project belonging to a different organization cannot be deleted (existing tenant scoping unchanged)", async () => {
    // A project created for orgB/clientB — acting as an orgA identity.
    const foreignProject = await createProject(fixtures.orgB.id, fixtures.clientB.id, fixtures.orgBOwner.id);
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await deleteProjectAction(foreignProject.id);

    expect(result).toEqual({ ok: true }); // "not found for this org" is a quiet no-op, same as before this change.
    const stillThere = await prisma.project.findUnique({ where: { id: foreignProject.id } });
    expect(stillThere).not.toBeNull();

    await prisma.project.deleteMany({ where: { id: foreignProject.id } });
  });

  it("an unrelated failure still propagates instead of being silently swallowed", async () => {
    const project = await createProject(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id);
    actAs(fixtures.owner, fixtures.orgA.id);

    const transactionSpy = vi
      .spyOn(prisma, "$transaction")
      .mockRejectedValueOnce(new Error("simulated unrelated database failure"));
    try {
      await expect(deleteProjectAction(project.id)).rejects.toThrow("simulated unrelated database failure");
    } finally {
      transactionSpy.mockRestore();
    }

    await prisma.project.deleteMany({ where: { id: project.id } });
  });

  it("attachment cleanup still runs inside the same transaction/order on a successful delete", async () => {
    const project = await createProject(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id);
    const attachmentId = randomUUID();
    const storagePath = `organizations/${fixtures.orgA.id}/PROJECT/${project.id}/${attachmentId}/file.pdf`;
    await prisma.attachment.create({
      data: {
        id: attachmentId,
        organizationId: fixtures.orgA.id,
        uploadedById: fixtures.owner.id,
        entityType: "PROJECT",
        entityId: project.id,
        storageBucket: "attachments",
        storagePath,
        originalName: "file.pdf",
        mimeType: "application/pdf",
        sizeBytes: 512,
      },
    });
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await deleteProjectAction(project.id);

    expect(result).toEqual({ ok: true });
    expect(await prisma.attachment.findFirst({ where: { entityId: project.id } })).toBeNull();
    expect(removedPaths).toContain(storagePath);
  });
});
