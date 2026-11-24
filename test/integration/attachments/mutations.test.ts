import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  uploadAttachmentForEntity,
  deleteAttachmentForEntity,
  deleteAttachmentsForParent,
} from "@/lib/attachments/attachment-mutations";
import { verifyPortalAttachmentAccess } from "@/lib/client-portal/attachments";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { setUploadShouldFail, resetStorageMock, removedPaths } from "../../support/storage-mock";

function makeFormData(name = "report.pdf", content = "hello"): FormData {
  const fd = new FormData();
  fd.set("file", new File([content], name, { type: "application/pdf" }));
  return fd;
}

describe("attachment mutations — real Prisma, mocked Storage (see test/support/storage-mock.ts)", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(() => {
    resetStorageMock();
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("valid upload creates an Attachment row and a FILE_UPLOADED Activity", async () => {
    const result = await uploadAttachmentForEntity({
      organizationId: fixtures.orgA.id,
      actorId: fixtures.owner.id,
      actorName: fixtures.owner.name,
      entityType: "CLIENT",
      entityId: fixtures.clientA.id,
      parentEntityLabel: fixtures.clientA.name,
      formData: makeFormData("new-valid-upload.pdf"),
    });

    expect(result.error).toBeNull();
    const attachment = await prisma.attachment.findFirst({
      where: { organizationId: fixtures.orgA.id, entityId: fixtures.clientA.id, originalName: "new-valid-upload.pdf" },
    });
    expect(attachment).not.toBeNull();

    const activity = await prisma.activity.findFirst({
      where: { entityId: attachment!.id, action: "FILE_UPLOADED" },
    });
    expect(activity).not.toBeNull();

    await prisma.activity.deleteMany({ where: { entityId: attachment!.id } });
    await prisma.attachment.deleteMany({ where: { id: attachment!.id } });
  });

  it("Storage upload failure is reported without ever creating an Attachment row", async () => {
    setUploadShouldFail(true);

    const result = await uploadAttachmentForEntity({
      organizationId: fixtures.orgA.id,
      actorId: fixtures.owner.id,
      actorName: fixtures.owner.name,
      entityType: "CLIENT",
      entityId: fixtures.clientA.id,
      parentEntityLabel: fixtures.clientA.name,
      formData: makeFormData("upload-fail-test.pdf"),
    });

    expect(result.error).toBe("Failed to upload the file. Please try again.");
    const row = await prisma.attachment.findFirst({ where: { originalName: "upload-fail-test.pdf" } });
    expect(row).toBeNull();
  });

  it("delete removes the Attachment row, logs FILE_DELETED, and removes the Storage object", async () => {
    const uploadResult = await uploadAttachmentForEntity({
      organizationId: fixtures.orgA.id,
      actorId: fixtures.owner.id,
      actorName: fixtures.owner.name,
      entityType: "CLIENT",
      entityId: fixtures.clientA.id,
      parentEntityLabel: fixtures.clientA.name,
      formData: makeFormData("to-delete.pdf"),
    });
    expect(uploadResult.error).toBeNull();
    const attachment = await prisma.attachment.findFirstOrThrow({ where: { originalName: "to-delete.pdf" } });

    await deleteAttachmentForEntity({
      organizationId: fixtures.orgA.id,
      actorId: fixtures.owner.id,
      actorName: fixtures.owner.name,
      attachmentId: attachment.id,
      entityType: "CLIENT",
      resolveParentLabel: async () => fixtures.clientA.name,
    });

    const gone = await prisma.attachment.findUnique({ where: { id: attachment.id } });
    expect(gone).toBeNull();
    const deletedActivity = await prisma.activity.findFirst({
      where: { entityId: attachment.id, action: "FILE_DELETED" },
    });
    expect(deletedActivity).not.toBeNull();
    expect(removedPaths).toContain(attachment.storagePath);

    await prisma.activity.deleteMany({ where: { entityId: attachment.id } });
  });

  it("an orphan attachment (entityId pointing at a Project/Invoice that no longer exists) is denied by verifyPortalAttachmentAccess, not crashed", async () => {
    const nonExistentProjectId = randomUUID();
    const orphan = await prisma.attachment.create({
      data: {
        organizationId: fixtures.orgA.id,
        uploadedById: fixtures.owner.id,
        entityType: "PROJECT",
        entityId: nonExistentProjectId,
        storageBucket: "attachments",
        storagePath: `organizations/${fixtures.orgA.id}/PROJECT/${nonExistentProjectId}/${randomUUID()}/orphan.pdf`,
        originalName: "orphan.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
      },
    });

    const allowed = await verifyPortalAttachmentAccess(orphan, {
      clientId: fixtures.clientA.id,
      organizationId: fixtures.orgA.id,
    });
    expect(allowed).toBe(false);

    await prisma.attachment.delete({ where: { id: orphan.id } });
  });

  it("deleteAttachmentsForParent cascades a batch of attachments and logs one FILE_DELETED each", async () => {
    const upload1 = await uploadAttachmentForEntity({
      organizationId: fixtures.orgA.id,
      actorId: fixtures.owner.id,
      actorName: fixtures.owner.name,
      entityType: "CLIENT",
      entityId: fixtures.clientA.id,
      parentEntityLabel: fixtures.clientA.name,
      formData: makeFormData("cascade-1.pdf"),
    });
    const upload2 = await uploadAttachmentForEntity({
      organizationId: fixtures.orgA.id,
      actorId: fixtures.owner.id,
      actorName: fixtures.owner.name,
      entityType: "CLIENT",
      entityId: fixtures.clientA.id,
      parentEntityLabel: fixtures.clientA.name,
      formData: makeFormData("cascade-2.pdf"),
    });
    expect(upload1.error).toBeNull();
    expect(upload2.error).toBeNull();

    const { storagePaths } = await prisma.$transaction((tx) =>
      deleteAttachmentsForParent(tx, {
        organizationId: fixtures.orgA.id,
        actorId: fixtures.owner.id,
        actorName: fixtures.owner.name,
        targets: [{ entityType: "CLIENT", entityId: fixtures.clientA.id, parentEntityLabel: fixtures.clientA.name }],
      }),
    );

    expect(storagePaths.length).toBeGreaterThanOrEqual(2);
    const remaining = await prisma.attachment.count({
      where: { entityId: fixtures.clientA.id, originalName: { in: ["cascade-1.pdf", "cascade-2.pdf"] } },
    });
    expect(remaining).toBe(0);
  });

  // Aqenra Free plan — concurrency correction. A bogus organizationId now
  // fails at the NEW, earlier reserveStorageBytes step (its own
  // StorageReservation insert hits the identical organizationId FK
  // constraint Attachment itself has) — BEFORE the mocked Storage
  // "upload" is ever called at all, unlike before this correction, when
  // this exact scenario reached the Storage mock first and only failed
  // once the Attachment row's own DB write ran. uploadAttachmentForEntity's
  // own try/catch around reserveStorageBytes (see that function's own
  // comment) converts the unexpected FK error into the same clean,
  // generic message, so this remains a clean-failure, not a crash.
  it("invalid organizationId: the reservation step itself fails (real FK constraint) before any Storage call is ever made", async () => {
    const bogusOrgId = randomUUID(); // syntactically valid UUID, no such Organization row

    const result = await uploadAttachmentForEntity({
      organizationId: bogusOrgId,
      actorId: fixtures.owner.id,
      actorName: fixtures.owner.name,
      entityType: "CLIENT",
      entityId: fixtures.clientA.id,
      parentEntityLabel: fixtures.clientA.name,
      formData: makeFormData("reservation-fk-test.pdf"),
    });

    expect(result.error).toBe("Failed to save the uploaded file. Please try again.");
    // Nothing was ever uploaded to (mocked) Storage for this request —
    // the reservation failed first — so there is nothing to compensate.
    expect(removedPaths).toHaveLength(0);

    const orphanedRow = await prisma.attachment.findFirst({ where: { organizationId: bogusOrgId } });
    expect(orphanedRow).toBeNull();
    const strandedReservation = await prisma.storageReservation.findFirst({ where: { organizationId: bogusOrgId } });
    expect(strandedReservation).toBeNull(); // the failed insert was never committed
  });

  // Run last, deliberately: this is the one test in this file that forces
  // a real transaction ROLLBACK (an FK violation on a bogus actorId, at
  // the Attachment row's own write — organizationId stays valid here, so
  // the new reservation step above succeeds first and the mocked Storage
  // "upload" genuinely runs, reproducing the scenario the reservation-
  // level test above no longer can). Empirically, PGlite's single
  // connection (see src/lib/prisma.ts's PGLITE_TEST_DB pool cap) does not
  // fully recover its wire-protocol state after servicing a rolled-back
  // transaction — subsequent queries on that same connection started
  // failing with an unrelated-looking Prisma deserialization error
  // ("_count$_all" field mismatch) until the process's Prisma client was
  // recreated. Real Postgres does not have this problem (rollback is a
  // normal, fully-recoverable operation there); this is specifically a
  // PGlite limitation. Keeping this test last means every other test in
  // this file still runs against a known-good connection. See the Stage 4
  // report for the full explanation — not something to paper over with a
  // fake assertion.
  it("invalid actorId: the Attachment row's own DB insert fails (real FK constraint) after a successful reservation and Storage upload, and both are compensated", async () => {
    const bogusActorId = randomUUID(); // syntactically valid UUID, no such User row

    const result = await uploadAttachmentForEntity({
      organizationId: fixtures.orgA.id,
      actorId: bogusActorId,
      actorName: "Nonexistent Actor",
      entityType: "CLIENT",
      entityId: fixtures.clientA.id,
      parentEntityLabel: fixtures.clientA.name,
      formData: makeFormData("rollback-test.pdf"),
    });

    expect(result.error).toBe("Failed to save the uploaded file. Please try again.");
    // The reservation succeeded (organizationId is valid), the mocked
    // Storage "upload" succeeded, then the Attachment row's own DB write
    // failed on the uploadedById FK violation —
    // uploadAttachmentForEntity's catch block must call
    // removeAttachmentObject to compensate the Storage side, exactly as
    // it would for a real Storage-backed upload.
    expect(removedPaths).toHaveLength(1);

    const orphanedRow = await prisma.attachment.findFirst({ where: { uploadedById: bogusActorId } });
    expect(orphanedRow).toBeNull(); // never committed — the transaction rolled back
    // The reservation itself is also released on this failure path — it
    // must never be left stranded just because the write it was standing
    // in for ultimately failed for an unrelated reason.
    const strandedReservation = await prisma.storageReservation.findFirst({ where: { organizationId: fixtures.orgA.id } });
    expect(strandedReservation).toBeNull();
  });
});

/**
 * Aqenra Free plan — concurrency correction. Real-application coverage
 * of the new reservation lifecycle wired into uploadAttachmentForEntity:
 * release on success (the reservation never outlives the committed
 * Attachment row it was standing in for), release on a mocked Storage
 * failure, and the storage-limit gate itself now actually applying to
 * this real upload path, not just the lightweight assertCanUploadAttachment
 * check tested directly in enforcement.test.ts. Its own dedicated
 * FREE-plan organization (never the shared fixtures above) so its
 * deliberately near-the-ceiling usage can't affect any other test.
 */
describe("attachment mutations — Aqenra Free plan storage reservation lifecycle", () => {
  async function createFreePlanOrg(label: string) {
    const owner = await prisma.user.create({
      data: { id: randomUUID(), email: `attach-res-${label}-${randomUUID().slice(0, 8)}@test.local`, name: `Reservation ${label}` },
    });
    const org = await prisma.organization.create({
      data: { name: `Reservation Org ${label}`, slug: `attach-res-${label}-${randomUUID().slice(0, 8)}` },
    });
    await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });
    const now = new Date();
    await prisma.subscription.create({
      data: { organizationId: org.id, planKey: "FREE", status: "ACTIVE", trialStartedAt: now, trialEndsAt: now },
    });
    const client = await prisma.client.create({ data: { name: `Reservation Client ${label}`, userId: owner.id, organizationId: org.id } });
    return { owner, org, client };
  }

  async function cleanup(org: { id: string }, owner: { id: string }, client: { id: string }) {
    await prisma.attachment.deleteMany({ where: { organizationId: org.id } });
    await prisma.storageReservation.deleteMany({ where: { organizationId: org.id } });
    await prisma.client.delete({ where: { id: client.id } });
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.user.delete({ where: { id: owner.id } });
  }

  afterEach(() => resetStorageMock());

  it("a successful upload leaves no reservation behind — only the real, committed Attachment row accounts for the bytes", async () => {
    const { owner, org, client } = await createFreePlanOrg(`success-${randomUUID().slice(0, 6)}`);
    try {
      const result = await uploadAttachmentForEntity({
        organizationId: org.id,
        actorId: owner.id,
        actorName: owner.name,
        entityType: "CLIENT",
        entityId: client.id,
        parentEntityLabel: client.name,
        formData: makeFormData("reservation-success.pdf"),
      });
      expect(result.error).toBeNull();

      const reservationCount = await prisma.storageReservation.count({ where: { organizationId: org.id } });
      expect(reservationCount).toBe(0);
      const attachmentCount = await prisma.attachment.count({ where: { organizationId: org.id } });
      expect(attachmentCount).toBe(1);
    } finally {
      await cleanup(org, owner, client);
    }
  });

  it("a Storage upload failure releases the reservation — no stranded capacity for an upload that never actually happened", async () => {
    const { owner, org, client } = await createFreePlanOrg(`storage-fail-${randomUUID().slice(0, 6)}`);
    try {
      setUploadShouldFail(true);
      const result = await uploadAttachmentForEntity({
        organizationId: org.id,
        actorId: owner.id,
        actorName: owner.name,
        entityType: "CLIENT",
        entityId: client.id,
        parentEntityLabel: client.name,
        formData: makeFormData("reservation-storage-fail.pdf"),
      });
      expect(result.error).toBe("Failed to upload the file. Please try again.");

      const reservationCount = await prisma.storageReservation.count({ where: { organizationId: org.id } });
      expect(reservationCount).toBe(0);
    } finally {
      await cleanup(org, owner, client);
    }
  });

  it("an upload that would push the organization over its 1 GiB FREE-plan ceiling is blocked, through the real reservation check — never reaching Storage at all", async () => {
    const { owner, org, client } = await createFreePlanOrg(`over-limit-${randomUUID().slice(0, 6)}`);
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
          sizeBytes: 1 * 1024 * 1024 * 1024, // already at the 1 GiB ceiling
        },
      });

      const result = await uploadAttachmentForEntity({
        organizationId: org.id,
        actorId: owner.id,
        actorName: owner.name,
        entityType: "CLIENT",
        entityId: client.id,
        parentEntityLabel: client.name,
        formData: makeFormData("over-limit.pdf"),
      });
      expect(result.error).toBe("Your storage limit has been reached.");

      // Never reached the mocked Storage call at all — blocked at the
      // reservation step, before any upload attempt.
      expect(removedPaths).toHaveLength(0);
      const attachmentCount = await prisma.attachment.count({ where: { organizationId: org.id, originalName: "over-limit.pdf" } });
      expect(attachmentCount).toBe(0);
      const reservationCount = await prisma.storageReservation.count({ where: { organizationId: org.id } });
      expect(reservationCount).toBe(0);
    } finally {
      await cleanup(org, owner, client);
    }
  });
});
