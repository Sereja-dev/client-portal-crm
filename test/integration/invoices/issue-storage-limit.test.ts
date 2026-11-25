import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

/**
 * Aqenra Free plan — owner-approved resolution of the invoice-PDF storage
 * question: invoice archival competes for the exact same organization-wide
 * 1 GiB allowance as Attachment/Logo writes (never a second, separate
 * quota, never a no-logo/regenerated substitute). If there is no room,
 * the invoice is NOT issued at all — it stays exactly as DRAFT.
 *
 * TEST_MODE=1 (top-level, this file only), mirroring issue.test.ts's own
 * established precedent and header comment for why this is scoped to this
 * file alone. Every organization here is created directly (never the
 * shared seedTestData() fixture) so its storage usage is fully under this
 * file's own control — the shared fixture organization has no real
 * storage ceiling (LEGACY plan, 1024 GiB) to exercise this against.
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
    data: { id: randomUUID(), email: `issue-limit-${label}-${randomUUID().slice(0, 8)}@test.local`, name: `Limit Owner ${label}` },
  });
  const org = await prisma.organization.create({
    data: { name: `Limit Org ${label}`, slug: `issue-limit-${label}-${randomUUID().slice(0, 8)}` },
  });
  await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });
  const now = new Date();
  await prisma.subscription.create({
    data: { organizationId: org.id, planKey: "FREE", status: "ACTIVE", trialStartedAt: now, trialEndsAt: now },
  });
  const client = await prisma.client.create({ data: { name: `Limit Client ${label}`, userId: owner.id, organizationId: org.id } });
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
      invoiceNumber: `INV-LIMIT-${label}-${randomUUID().slice(0, 8)}`,
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

async function fillStorage(org: { id: string }, client: { id: string }, bytes: number) {
  await prisma.attachment.create({
    data: {
      organizationId: org.id,
      entityType: "CLIENT",
      entityId: client.id,
      storageBucket: "attachments",
      storagePath: `test/${randomUUID()}`,
      originalName: "existing.pdf",
      mimeType: "application/pdf",
      sizeBytes: bytes,
    },
  });
}

const GIB = 1024 * 1024 * 1024;

describe("issueInvoice — Aqenra Free plan shared storage allowance", () => {
  it("storage already at the 1 GiB ceiling (filled by an ordinary Attachment): the invoice is NOT issued, stays exactly DRAFT, and no Storage/ledger/Activity side effect exists", async () => {
    const { owner, org, client } = await createFreePlanOrgWithClient(`full-${randomUUID().slice(0, 6)}`);
    try {
      await fillStorage(org, client, GIB);
      const invoice = await seedDraftInvoice(org, client, "full");

      const result = await issueInvoice({
        actor: { organizationId: org.id, userId: owner.id, userName: owner.name, role: "OWNER" },
        invoiceId: invoice.id,
        expectedUpdatedAt: invoice.updatedAt.toISOString(),
      });

      expect(result).toEqual({ ok: false, error: "STORAGE_LIMIT_REACHED" });

      // A failed attempt must not leave the invoice falsely marked as
      // issued — every field a successful Issue would have changed is
      // byte-for-byte untouched.
      const after = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(after.status).toBe("DRAFT");
      expect(after.finalizedAt).toBeNull();
      expect(after.pdfStoragePath).toBeNull();
      expect(after.pdfGeneratedAt).toBeNull();
      expect(after.issuerSnapshot).toBeNull();
      expect(after.recipientSnapshot).toBeNull();
      expect(after.updatedAt.getTime()).toBe(invoice.updatedAt.getTime());
      expect(classifyInvoiceArchival(after).kind).toBe("draft");

      const ledgerCount = await prisma.invoicePdfArchiveObject.count({ where: { invoiceId: invoice.id } });
      expect(ledgerCount).toBe(0);
      const reservationCount = await prisma.storageReservation.count({ where: { organizationId: org.id } });
      expect(reservationCount).toBe(0);
      const activities = await prisma.activity.count({ where: { entityType: "INVOICE", entityId: invoice.id } });
      expect(activities).toBe(0);
    } finally {
      await cleanupOrg(org, owner, client);
    }
  });

  it("well under the limit: archival proceeds exactly as before — real PDF object written, reservation released afterward, no double counting", async () => {
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

      expect(result).toEqual({ ok: true, invoiceId: invoice.id, finalizedAt: fixedNow });

      const after = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(after.pdfStoragePath).toBeTruthy();
      expect(classifyInvoiceArchival(after).kind).toBe("archived");

      const ledger = await prisma.invoicePdfArchiveObject.findFirstOrThrow({ where: { invoiceId: invoice.id } });
      expect(ledger.status).toBe("REFERENCED");
      expect(ledger.sizeBytes).toBeGreaterThan(0);

      const stored = testStorageRead("attachments", after.pdfStoragePath!);
      expect(stored).not.toBeNull();
      expect(isPdfSignature(stored!.body)).toBe(true);

      const reservationCount = await prisma.storageReservation.count({ where: { organizationId: org.id } });
      expect(reservationCount).toBe(0);

      const usage = await prisma.invoicePdfArchiveObject.aggregate({
        where: { organizationId: org.id, status: "REFERENCED" },
        _sum: { sizeBytes: true },
      });
      expect(usage._sum.sizeBytes).toBe(ledger.sizeBytes);
    } finally {
      await cleanupOrg(org, owner, client);
    }
  });

  it("exactly at the boundary (existing usage leaves precisely enough room for this PDF's real rendered size): succeeds", async () => {
    const { owner, org, client } = await createFreePlanOrgWithClient(`exact-${randomUUID().slice(0, 6)}`);
    try {
      const invoice = await seedDraftInvoice(org, client, "exact");

      // First render the real PDF once (without committing an Issue) to
      // learn its exact byte length, then fill storage to leave exactly
      // that much room — the real boundary condition, not an estimate.
      const probe = await issueInvoice({
        actor: { organizationId: org.id, userId: owner.id, userName: owner.name, role: "OWNER" },
        invoiceId: invoice.id,
        expectedUpdatedAt: invoice.updatedAt.toISOString(),
      });
      expect(probe.ok).toBe(true);
      const probedInvoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      const pdfSize = (await prisma.invoicePdfArchiveObject.findFirstOrThrow({ where: { invoiceId: invoice.id } })).sizeBytes!;

      // Reset back to a fresh DRAFT with the exact same content, then
      // fill storage so exactly `pdfSize` bytes of headroom remain.
      await prisma.invoicePdfArchiveObject.deleteMany({ where: { invoiceId: invoice.id } });
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: "DRAFT",
          finalizedAt: null,
          pdfGeneratedAt: null,
          pdfStoragePath: null,
          issuerSnapshot: Prisma.DbNull,
          recipientSnapshot: Prisma.DbNull,
          updatedAt: probedInvoice.updatedAt,
        },
      });
      await fillStorage(org, client, GIB - pdfSize);

      const fresh = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      const result = await issueInvoice({
        actor: { organizationId: org.id, userId: owner.id, userName: owner.name, role: "OWNER" },
        invoiceId: invoice.id,
        expectedUpdatedAt: fresh.updatedAt.toISOString(),
      });

      expect(result.ok).toBe(true);
      const totalUsage = await prisma.invoicePdfArchiveObject.aggregate({
        where: { organizationId: org.id, status: "REFERENCED" },
        _sum: { sizeBytes: true },
      });
      const attachmentUsage = await prisma.attachment.aggregate({ where: { organizationId: org.id }, _sum: { sizeBytes: true } });
      expect((totalUsage._sum.sizeBytes ?? 0) + (attachmentUsage._sum.sizeBytes ?? 0)).toBe(GIB);
    } finally {
      await cleanupOrg(org, owner, client);
    }
  });

  it("one byte over the boundary: rejected with STORAGE_LIMIT_REACHED, never partially archived", async () => {
    const { owner, org, client } = await createFreePlanOrgWithClient(`over-${randomUUID().slice(0, 6)}`);
    try {
      const invoice = await seedDraftInvoice(org, client, "over");

      const probe = await issueInvoice({
        actor: { organizationId: org.id, userId: owner.id, userName: owner.name, role: "OWNER" },
        invoiceId: invoice.id,
        expectedUpdatedAt: invoice.updatedAt.toISOString(),
      });
      expect(probe.ok).toBe(true);
      const probedInvoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      const pdfSize = (await prisma.invoicePdfArchiveObject.findFirstOrThrow({ where: { invoiceId: invoice.id } })).sizeBytes!;

      await prisma.invoicePdfArchiveObject.deleteMany({ where: { invoiceId: invoice.id } });
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: "DRAFT",
          finalizedAt: null,
          pdfGeneratedAt: null,
          pdfStoragePath: null,
          issuerSnapshot: Prisma.DbNull,
          recipientSnapshot: Prisma.DbNull,
          updatedAt: probedInvoice.updatedAt,
        },
      });
      // One byte less headroom than the PDF actually needs.
      await fillStorage(org, client, GIB - pdfSize + 1);

      const fresh = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      const result = await issueInvoice({
        actor: { organizationId: org.id, userId: owner.id, userName: owner.name, role: "OWNER" },
        invoiceId: invoice.id,
        expectedUpdatedAt: fresh.updatedAt.toISOString(),
      });

      expect(result).toEqual({ ok: false, error: "STORAGE_LIMIT_REACHED" });
      const ledgerCount = await prisma.invoicePdfArchiveObject.count({ where: { invoiceId: invoice.id } });
      expect(ledgerCount).toBe(0);
    } finally {
      await cleanupOrg(org, owner, client);
    }
  });

  it("invoice archival competing with an attachment for the last headroom — whichever commits first wins; the other sees STORAGE_LIMIT_REACHED and stays untouched", async () => {
    const { owner, org, client } = await createFreePlanOrgWithClient(`shared-${randomUUID().slice(0, 6)}`);
    try {
      const invoice = await seedDraftInvoice(org, client, "shared");

      const probe = await issueInvoice({
        actor: { organizationId: org.id, userId: owner.id, userName: owner.name, role: "OWNER" },
        invoiceId: invoice.id,
        expectedUpdatedAt: invoice.updatedAt.toISOString(),
      });
      expect(probe.ok).toBe(true);
      const probedInvoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      const pdfSize = (await prisma.invoicePdfArchiveObject.findFirstOrThrow({ where: { invoiceId: invoice.id } })).sizeBytes!;
      await prisma.invoicePdfArchiveObject.deleteMany({ where: { invoiceId: invoice.id } });
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: "DRAFT",
          finalizedAt: null,
          pdfGeneratedAt: null,
          pdfStoragePath: null,
          issuerSnapshot: Prisma.DbNull,
          recipientSnapshot: Prisma.DbNull,
          updatedAt: probedInvoice.updatedAt,
        },
      });

      // Leave exactly enough room for the invoice's PDF, but then also
      // let an ordinary attachment attempt to use that exact same
      // headroom — proving the two real, different write paths share
      // the identical pool, not two independent ones.
      await fillStorage(org, client, GIB - pdfSize);
      const { reserveStorageBytes } = await import("@/lib/billing/storage-reservation");
      const attachmentReservation = await reserveStorageBytes(org.id, pdfSize);
      expect(attachmentReservation.ok).toBe(true); // it alone still fits

      const fresh = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      const result = await issueInvoice({
        actor: { organizationId: org.id, userId: owner.id, userName: owner.name, role: "OWNER" },
        invoiceId: invoice.id,
        expectedUpdatedAt: fresh.updatedAt.toISOString(),
      });

      // The attachment's own reservation is still active — the invoice's
      // own attempt correctly sees no room left.
      expect(result).toEqual({ ok: false, error: "STORAGE_LIMIT_REACHED" });

      const { releaseStorageReservation } = await import("@/lib/billing/storage-reservation");
      if (attachmentReservation.ok) await releaseStorageReservation(attachmentReservation.reservationId);
    } finally {
      await cleanupOrg(org, owner, client);
    }
  });

  it("a ledger-creation failure (archiveId collision) releases the reservation — a retry afterward can still succeed", async () => {
    const { owner, org, client } = await createFreePlanOrgWithClient(`ledger-fail-${randomUUID().slice(0, 6)}`);
    try {
      const invoice = await seedDraftInvoice(org, client, "ledgerfail");
      const collidingId = randomUUID();
      // Pre-seed a row with the id the next generateArchiveId() override
      // will also return, forcing the real Prisma unique-constraint
      // violation this test wants — a different org, since this is only
      // about colliding on `id`, never about this invoice's own identity.
      const other = await createFreePlanOrgWithClient(`ledger-fail-other-${randomUUID().slice(0, 6)}`);
      try {
        await prisma.invoicePdfArchiveObject.create({
          data: {
            id: collidingId,
            organizationId: other.org.id,
            documentVersion: 1,
            storagePath: `test/${randomUUID()}`,
            status: "PENDING_UPLOAD",
          },
        });

        const result = await issueInvoice(
          {
            actor: { organizationId: org.id, userId: owner.id, userName: owner.name, role: "OWNER" },
            invoiceId: invoice.id,
            expectedUpdatedAt: invoice.updatedAt.toISOString(),
          },
          { generateArchiveId: () => collidingId },
        );

        expect(result).toEqual({ ok: false, error: "FINALIZATION_FAILED" });
        // The reservation this failed attempt took is released — not
        // stranded — confirmed by a normal retry (a fresh archiveId)
        // succeeding immediately afterward on the identical invoice.
        const reservationCount = await prisma.storageReservation.count({ where: { organizationId: org.id } });
        expect(reservationCount).toBe(0);

        const stillDraft = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
        expect(stillDraft.status).toBe("DRAFT");

        const retry = await issueInvoice({
          actor: { organizationId: org.id, userId: owner.id, userName: owner.name, role: "OWNER" },
          invoiceId: invoice.id,
          expectedUpdatedAt: stillDraft.updatedAt.toISOString(),
        });
        expect(retry.ok).toBe(true);
      } finally {
        await prisma.invoicePdfArchiveObject.deleteMany({ where: { id: collidingId } });
        await cleanupOrg(other.org, other.owner, other.client);
      }
    } finally {
      await cleanupOrg(org, owner, client);
    }
  });

  it("an upload failure releases the reservation alongside the existing compensation path", async () => {
    const { owner, org, client } = await createFreePlanOrgWithClient(`upload-fail-${randomUUID().slice(0, 6)}`);
    try {
      const invoice = await seedDraftInvoice(org, client, "uploadfail");

      const result = await issueInvoice(
        {
          actor: { organizationId: org.id, userId: owner.id, userName: owner.name, role: "OWNER" },
          invoiceId: invoice.id,
          expectedUpdatedAt: invoice.updatedAt.toISOString(),
        },
        { upload: async () => ({ ok: false, reason: "upload_failed" }) },
      );

      expect(result).toEqual({ ok: false, error: "UPLOAD_FAILED" });
      const reservationCount = await prisma.storageReservation.count({ where: { organizationId: org.id } });
      expect(reservationCount).toBe(0);
      const ledger = await prisma.invoicePdfArchiveObject.findFirstOrThrow({ where: { invoiceId: invoice.id } });
      expect(ledger.status).toBe("CLEANED");

      const stillDraft = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(stillDraft.status).toBe("DRAFT");
    } finally {
      await cleanupOrg(org, owner, client);
    }
  });

  it("a reservation that outlives its own TTL stops counting — a documented, accepted limitation, not silently claimed as solved", async () => {
    const { owner, org, client } = await createFreePlanOrgWithClient(`ttl-${randomUUID().slice(0, 6)}`);
    try {
      const { reserveStorageBytes, releaseStorageReservation } = await import("@/lib/billing/storage-reservation");
      const almostFull = Math.round(GIB * 0.9);
      const headroom = GIB - almostFull;
      await fillStorage(org, client, almostFull);

      // R1 reserves ALL remaining headroom for a hypothetical slow
      // archival, then is forced to already be expired — simulating an
      // archival that has outlived the 10-minute TTL (a genuinely slow
      // upload, or a crashed process that never released it). Critically,
      // issueInvoice()'s own pipeline never re-checks R1 before archiving
      // — it already got its "yes" and proceeds independently of whether
      // that reservation is still alive by the time it finishes.
      const r1 = await reserveStorageBytes(org.id, headroom);
      expect(r1.ok).toBe(true);
      if (!r1.ok) throw new Error("unreachable");
      await prisma.storageReservation.update({
        where: { id: r1.reservationId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      // A second, independent operation can now reserve and commit the
      // SAME headroom — R1 no longer counts once expired. This is the
      // documented self-healing behavior, not a bug on its own.
      const r2 = await reserveStorageBytes(org.id, headroom);
      expect(r2.ok).toBe(true);
      if (!r2.ok) throw new Error("unreachable");
      await prisma.attachment.create({
        data: {
          organizationId: org.id,
          entityType: "CLIENT",
          entityId: client.id,
          storageBucket: "attachments",
          storagePath: `test/${randomUUID()}`,
          originalName: "second.pdf",
          mimeType: "application/pdf",
          sizeBytes: headroom,
        },
      });
      await releaseStorageReservation(r2.reservationId);

      // R1's own "slow" operation now finally finalizes — nothing in the
      // real pipeline stops it, since the reservation was only ever
      // consulted once, up front. It commits its full real ledger row
      // exactly as issueInvoice()'s own success path does.
      await prisma.invoicePdfArchiveObject.create({
        data: {
          id: randomUUID(),
          organizationId: org.id,
          invoiceId: null,
          documentVersion: 1,
          storagePath: `invoices/${randomUUID()}.pdf`,
          status: "REFERENCED",
          referencedAt: new Date(),
          sizeBytes: headroom,
        },
      });
      await releaseStorageReservation(r1.reservationId);

      const attachmentUsage = await prisma.attachment.aggregate({ where: { organizationId: org.id }, _sum: { sizeBytes: true } });
      const invoiceUsage = await prisma.invoicePdfArchiveObject.aggregate({
        where: { organizationId: org.id, status: "REFERENCED" },
        _sum: { sizeBytes: true },
      });
      const totalUsage = (attachmentUsage._sum.sizeBytes ?? 0) + (invoiceUsage._sum.sizeBytes ?? 0);
      // Demonstrates the real, accepted limitation named in this task:
      // once a reservation outlives its own TTL, the operation it was
      // guarding can still land later, so two operations that should
      // have been mutually exclusive both committed — together
      // exceeding the 1 GiB ceiling. This is not asserted as acceptable
      // or unacceptable here — only that it is real and reproducible,
      // not silently assumed away by the TTL's own existence.
      expect(totalUsage).toBeGreaterThan(GIB);
    } finally {
      await cleanupOrg(org, owner, client);
    }
  });
});
