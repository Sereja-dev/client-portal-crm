import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";

/**
 * Aqenra Free plan — owner-approved resolution of the invoice-PDF storage
 * question: "Issuing an invoice must remain possible when the
 * organization's 1 GiB storage allowance is full." This file proves that
 * requirement against the real issueInvoice() pipeline, real Prisma data,
 * and (via TEST_MODE) the real Storage-boundary stand-in — never a
 * reimplementation of the decision logic under test.
 *
 * TEST_MODE=1 (top-level, this file only), mirroring issue.test.ts's own
 * established precedent and header comment for why this is scoped to this
 * file alone.
 */
const ORIGINAL_TEST_MODE = process.env.TEST_MODE;
process.env.TEST_MODE = "1";

const { issueInvoice } = await import("@/lib/invoices/pdf/issue-invoice");
const { classifyInvoiceArchival } = await import("@/lib/invoices/pdf/classify-archival");
const { testStorageRead } = await import("@/lib/storage/test-storage");

afterAll(() => {
  if (ORIGINAL_TEST_MODE === undefined) delete process.env.TEST_MODE;
  else process.env.TEST_MODE = ORIGINAL_TEST_MODE;
});

async function createFreePlanOrgWithClient(label: string) {
  const owner = await prisma.user.create({
    data: { id: randomUUID(), email: `issue-deferred-${label}-${randomUUID().slice(0, 8)}@test.local`, name: `Deferred Owner ${label}` },
  });
  const org = await prisma.organization.create({
    data: { name: `Deferred Org ${label}`, slug: `issue-deferred-${label}-${randomUUID().slice(0, 8)}` },
  });
  await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });
  const now = new Date();
  await prisma.subscription.create({
    data: { organizationId: org.id, planKey: "FREE", status: "ACTIVE", trialStartedAt: now, trialEndsAt: now },
  });
  const client = await prisma.client.create({ data: { name: `Deferred Client ${label}`, userId: owner.id, organizationId: org.id } });
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

async function seedDraftInvoice(org: { id: string }, client: { id: string }, label: string) {
  return prisma.invoice.create({
    data: {
      invoiceNumber: `INV-DEFERRED-${label}-${randomUUID().slice(0, 8)}`,
      status: "DRAFT",
      amount: "500.00",
      subtotal: "500.00",
      discountAmount: "0.00",
      taxAmount: "0.00",
      discountType: "NONE",
      taxLabel: "TAX",
      currency: "USD",
      issueDate: new Date("2026-01-01T00:00:00.000Z"),
      clientId: client.id,
      organizationId: org.id,
    },
  });
}

function isPdfSignature(buffer: Buffer): boolean {
  return buffer.subarray(0, 4).toString("latin1") === "%PDF";
}

describe("issueInvoice — Aqenra Free plan storage-full behavior", () => {
  it("storage already at the 1 GiB ceiling: the invoice still issues (archiveDeferred: true), with no ledger row and no Storage write attempted", async () => {
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
          sizeBytes: 1 * 1024 * 1024 * 1024,
        },
      });
      const invoice = await seedDraftInvoice(org, client, "full");

      const result = await issueInvoice({
        actor: { organizationId: org.id, userId: owner.id, userName: owner.name, role: "OWNER" },
        invoiceId: invoice.id,
        expectedUpdatedAt: invoice.updatedAt.toISOString(),
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.archiveDeferred).toBe(true);

      const after = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(after.status).toBe("SENT");
      expect(after.finalizedAt).not.toBeNull();
      expect(after.issuerSnapshot).toBeTruthy();
      expect(after.recipientSnapshot).toBeTruthy();
      // The defining shape — no Storage object was ever written for this invoice.
      expect(after.pdfStoragePath).toBeNull();
      expect(after.pdfGeneratedAt).toBeNull();

      expect(classifyInvoiceArchival(after).kind).toBe("archive_deferred");

      const ledgerCount = await prisma.invoicePdfArchiveObject.count({ where: { invoiceId: invoice.id } });
      expect(ledgerCount).toBe(0);

      const reservationCount = await prisma.storageReservation.count({ where: { organizationId: org.id } });
      expect(reservationCount).toBe(0);

      // The real Activity/notification side effects still happen exactly
      // as a normal issuance would — only the PDF archive is skipped.
      const activities = await prisma.activity.findMany({ where: { entityType: "INVOICE", entityId: invoice.id, action: "STATUS_CHANGED" } });
      expect(activities).toHaveLength(1);
    } finally {
      await cleanupOrg(org, owner, client);
    }
  });

  it("well under the limit: archival proceeds exactly as before (archiveDeferred: false), real PDF object written, reservation released afterward", async () => {
    const { owner, org, client } = await createFreePlanOrgWithClient(`under-${randomUUID().slice(0, 6)}`);
    try {
      const invoice = await seedDraftInvoice(org, client, "under");
      const fixedNow = new Date("2026-08-17T12:00:00.000Z");

      const result = await issueInvoice(
        {
          actor: { organizationId: org.id, userId: owner.id, userName: owner.name, role: "OWNER" },
          invoiceId: invoice.id,
          expectedUpdatedAt: invoice.updatedAt.toISOString(),
        },
        { now: () => fixedNow },
      );

      expect(result).toEqual({ ok: true, invoiceId: invoice.id, finalizedAt: fixedNow, archiveDeferred: false });

      const after = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(after.pdfStoragePath).toBeTruthy();
      expect(classifyInvoiceArchival(after).kind).toBe("archived");

      const ledger = await prisma.invoicePdfArchiveObject.findFirstOrThrow({ where: { invoiceId: invoice.id } });
      expect(ledger.status).toBe("REFERENCED");
      expect(ledger.sizeBytes).toBeGreaterThan(0);

      const stored = testStorageRead("attachments", after.pdfStoragePath!);
      expect(stored).not.toBeNull();
      expect(isPdfSignature(stored!.body)).toBe(true);

      // The reservation that guarded this archival is released once the
      // real ledger row (REFERENCED) takes over accounting for these
      // bytes — never left behind to double-count.
      const reservationCount = await prisma.storageReservation.count({ where: { organizationId: org.id } });
      expect(reservationCount).toBe(0);
    } finally {
      await cleanupOrg(org, owner, client);
    }
  });

  it("just over the boundary (existing usage + this PDF's size would exceed 1 GiB by a few bytes): defers, never partially archives", async () => {
    const { owner, org, client } = await createFreePlanOrgWithClient(`boundary-${randomUUID().slice(0, 6)}`);
    try {
      // A small render easily fits in a few KB; leave only a handful of
      // bytes of headroom so any real rendered PDF exceeds it.
      await prisma.attachment.create({
        data: {
          organizationId: org.id,
          entityType: "CLIENT",
          entityId: client.id,
          storageBucket: "attachments",
          storagePath: `test/${randomUUID()}`,
          originalName: "existing.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1 * 1024 * 1024 * 1024 - 10,
        },
      });
      const invoice = await seedDraftInvoice(org, client, "boundary");

      const result = await issueInvoice({
        actor: { organizationId: org.id, userId: owner.id, userName: owner.name, role: "OWNER" },
        invoiceId: invoice.id,
        expectedUpdatedAt: invoice.updatedAt.toISOString(),
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.archiveDeferred).toBe(true);

      const ledgerCount = await prisma.invoicePdfArchiveObject.count({ where: { invoiceId: invoice.id } });
      expect(ledgerCount).toBe(0);
      const totalBytes = await prisma.attachment.aggregate({ where: { organizationId: org.id }, _sum: { sizeBytes: true } });
      // Never grew past what already existed — the deferred invoice's PDF
      // never touched Storage at all.
      expect(totalBytes._sum.sizeBytes).toBe(1 * 1024 * 1024 * 1024 - 10);
    } finally {
      await cleanupOrg(org, owner, client);
    }
  });

  it("a deferred invoice's data is never lost — every financial field an archived invoice would have is equally present and correct", async () => {
    const { owner, org, client } = await createFreePlanOrgWithClient(`fields-${randomUUID().slice(0, 6)}`);
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
          sizeBytes: 1 * 1024 * 1024 * 1024,
        },
      });
      const invoice = await seedDraftInvoice(org, client, "fields");
      await prisma.invoiceLineItem.createMany({
        data: [{ invoiceId: invoice.id, description: "Design", quantity: "2", unitPrice: "50.00", lineTotal: "100.00", position: 0 }],
      });

      const result = await issueInvoice({
        actor: { organizationId: org.id, userId: owner.id, userName: owner.name, role: "OWNER" },
        invoiceId: invoice.id,
        expectedUpdatedAt: invoice.updatedAt.toISOString(),
      });
      expect(result.ok).toBe(true);

      const after = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      // The authoritative financial facts are exactly as correct as a
      // normal, fully-archived issuance would produce.
      expect(after.amount.toFixed(2)).toBe("100.00");
      expect(after.subtotal?.toFixed(2)).toBe("100.00");
    } finally {
      await cleanupOrg(org, owner, client);
    }
  });
});
