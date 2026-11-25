import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";

/**
 * Aqenra Free plan — Legacy Archive shares the exact same organization-
 * wide 1 GiB storage allowance as ordinary Issue, since both write to the
 * identical InvoicePdfArchiveObject ledger and consume the identical pool
 * (see legacy-archive-invoice.ts's own reserveStorageBytes call site).
 * Mirrors issue-storage-limit.test.ts's own structure and conventions.
 */
const ORIGINAL_TEST_MODE = process.env.TEST_MODE;
process.env.TEST_MODE = "1";

const { archiveLegacyInvoice } = await import("@/lib/invoices/pdf/legacy-archive-invoice");

afterAll(() => {
  if (ORIGINAL_TEST_MODE === undefined) delete process.env.TEST_MODE;
  else process.env.TEST_MODE = ORIGINAL_TEST_MODE;
});

async function createFreePlanOrgWithClient(label: string) {
  const owner = await prisma.user.create({
    data: { id: randomUUID(), email: `legacy-limit-${label}-${randomUUID().slice(0, 8)}@test.local`, name: `Legacy Limit Owner ${label}` },
  });
  const org = await prisma.organization.create({
    data: { name: `Legacy Limit Org ${label}`, slug: `legacy-limit-${label}-${randomUUID().slice(0, 8)}` },
  });
  await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });
  const now = new Date();
  await prisma.subscription.create({
    data: { organizationId: org.id, planKey: "FREE", status: "ACTIVE", trialStartedAt: now, trialEndsAt: now },
  });
  const client = await prisma.client.create({ data: { name: `Legacy Limit Client ${label}`, userId: owner.id, organizationId: org.id } });
  return { owner, org, client };
}

async function cleanupOrg(org: { id: string }, owner: { id: string }, client: { id: string }) {
  await prisma.invoicePdfArchiveObject.deleteMany({ where: { organizationId: org.id } });
  await prisma.invoice.deleteMany({ where: { organizationId: org.id } });
  await prisma.storageReservation.deleteMany({ where: { organizationId: org.id } });
  await prisma.attachment.deleteMany({ where: { organizationId: org.id } });
  await prisma.client.delete({ where: { id: client.id } });
  await prisma.organization.delete({ where: { id: org.id } });
  await prisma.user.delete({ where: { id: owner.id } });
}

async function seedLegacyInvoice(org: { id: string }, client: { id: string }, label: string) {
  return prisma.invoice.create({
    data: {
      invoiceNumber: `INV-LEGACY-LIMIT-${label}-${randomUUID().slice(0, 8)}`,
      status: "SENT",
      amount: "500.00",
      subtotal: "500.00",
      discountAmount: "0.00",
      taxAmount: "0.00",
      discountType: "NONE",
      taxLabel: "TAX",
      currency: "USD",
      issueDate: new Date("2020-01-01T00:00:00.000Z"),
      clientId: client.id,
      organizationId: org.id,
      // finalizedAt/pdfStoragePath/pdfGeneratedAt/snapshots all null —
      // the real legacy_eligible shape.
    },
  });
}

const GIB = 1024 * 1024 * 1024;

describe("archiveLegacyInvoice — Aqenra Free plan shared storage allowance", () => {
  it("storage already at the ceiling: the row is NOT archived, stays legacy_eligible, no Storage/ledger side effect", async () => {
    const { owner, org, client } = await createFreePlanOrgWithClient(`full-${randomUUID().slice(0, 6)}`);
    try {
      await prisma.attachment.create({
        data: {
          organizationId: org.id,
          entityType: "CLIENT",
          entityId: client.id,
          storageBucket: "attachments",
          storagePath: `test/${randomUUID()}`,
          originalName: "existing.pdf",
          mimeType: "application/pdf",
          sizeBytes: GIB,
        },
      });
      const invoice = await seedLegacyInvoice(org, client, "full");

      const result = await archiveLegacyInvoice({
        actor: { organizationId: org.id, userId: owner.id, userName: owner.name, role: "OWNER" },
        invoiceId: invoice.id,
        expectedUpdatedAt: invoice.updatedAt.toISOString(),
      });

      expect(result).toEqual({ ok: false, error: "STORAGE_LIMIT_REACHED" });

      const after = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(after.finalizedAt).toBeNull();
      expect(after.pdfStoragePath).toBeNull();
      expect(after.status).toBe("SENT"); // never rewritten — Legacy Archive never changes status anyway
      const ledgerCount = await prisma.invoicePdfArchiveObject.count({ where: { invoiceId: invoice.id } });
      expect(ledgerCount).toBe(0);
      const reservationCount = await prisma.storageReservation.count({ where: { organizationId: org.id } });
      expect(reservationCount).toBe(0);
    } finally {
      await cleanupOrg(org, owner, client);
    }
  });

  it("well under the limit: archives exactly as before, reservation released afterward", async () => {
    const { owner, org, client } = await createFreePlanOrgWithClient(`under-${randomUUID().slice(0, 6)}`);
    try {
      const invoice = await seedLegacyInvoice(org, client, "under");

      const result = await archiveLegacyInvoice({
        actor: { organizationId: org.id, userId: owner.id, userName: owner.name, role: "OWNER" },
        invoiceId: invoice.id,
        expectedUpdatedAt: invoice.updatedAt.toISOString(),
      });

      expect(result.ok).toBe(true);
      const after = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(after.pdfStoragePath).toBeTruthy();
      const ledger = await prisma.invoicePdfArchiveObject.findFirstOrThrow({ where: { invoiceId: invoice.id } });
      expect(ledger.status).toBe("REFERENCED");
      const reservationCount = await prisma.storageReservation.count({ where: { organizationId: org.id } });
      expect(reservationCount).toBe(0);
    } finally {
      await cleanupOrg(org, owner, client);
    }
  });
});
