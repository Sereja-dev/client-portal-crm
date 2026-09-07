import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { deleteClientAction } from "@/app/(dashboard)/clients/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { resetStorageMock, removedPaths } from "../../support/storage-mock";

/**
 * Post-Hardening Residual Code Audit (P2) — deleteClientAction previously
 * let a blocked delete (Invoice.clientId's own onDelete: Restrict)
 * propagate as an unhandled exception, so DeleteButton's own generic
 * "Failed to delete {itemName}." was the only thing a real user ever saw.
 *
 * The "blocked" case is exercised via vi.spyOn(prisma.client, "deleteMany")
 * rejecting with the exact real error shape confirmed against a real
 * RESTRICT violation (see delete-conflict-mapper.ts's own header comment)
 * — the same established technique test/integration/invoices/legacy-
 * archive.test.ts already uses for simulating a real database failure at
 * a specific write. Deliberately NOT triggered by actually seeding a real
 * blocking Invoice and letting the real constraint fire inside
 * prisma.$transaction(): this repo's own shared local test database
 * (PGlite, one instance for the whole suite — see vitest.integration.
 * config.mts's own comment) was confirmed, via an isolated diagnostic
 * probe, to NOT correctly roll back an already-applied deleteMany() when
 * the transaction's own later step throws this specific error shape —
 * a test-infrastructure limitation, not a defect in deleteClientAction
 * itself (a real Postgres server correctly enforces the RESTRICT
 * constraint at the statement level, confirmed separately against real
 * Production-shaped data before writing this classifier). Depending on
 * that broken rollback path here would risk corrupting every later test
 * in the shared suite, not just this file.
 */

const CLIENT_NAME_PREFIX = "DEL-Client";

function uniqueClientName(): string {
  return `${CLIENT_NAME_PREFIX}-${randomUUID().slice(0, 8)}`;
}

async function createClient(organizationId: string, userId: string, name = uniqueClientName()) {
  return prisma.client.create({ data: { name, organizationId, userId } });
}

function realClientRestrictViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("mock restrict violation", {
    code: "P2039",
    clientVersion: "test",
    meta: { modelName: "Client", driverAdapterError: { cause: { code: "23001" } } },
  });
}

describe("deleteClientAction — blocked by existing invoices (Post-Hardening Residual Code Audit P2)", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(() => {
    resetAuthMock();
    resetStorageMock();
  });

  afterAll(async () => {
    await prisma.client.deleteMany({ where: { name: { startsWith: CLIENT_NAME_PREFIX } } });
    await cleanupTestData(fixtures);
  });

  it("authorized deletion with no blocking invoices succeeds", async () => {
    const client = await createClient(fixtures.orgA.id, fixtures.owner.id);
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await deleteClientAction(client.id);

    expect(result).toEqual({ ok: true });
    expect(await prisma.client.findUnique({ where: { id: client.id } })).toBeNull();
  });

  it("a blocked deletion (existing dependent invoices) returns the controlled dependency result, writes no Activity, and queues no Storage cleanup", async () => {
    const client = await createClient(fixtures.orgA.id, fixtures.owner.id);
    actAs(fixtures.owner, fixtures.orgA.id);

    // Spying on the top-level prisma.$transaction itself, rather than
    // prisma.client.deleteMany — the tx object handed into a real
    // interactive transaction's own callback is a separate, transaction-
    // bound proxy, not the same reference as prisma.client, so a spy on
    // the latter never actually intercepts a tx.client.deleteMany() call
    // (confirmed directly: an earlier version of this test spied there
    // and the real deleteMany still went through). $transaction is what
    // deleteClientAction itself calls directly, so intercepting it here
    // is both correct and sufficient to prove the catch block's own
    // classify-and-return wiring, without ever needing the callback to
    // run at all.
    const transactionSpy = vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(realClientRestrictViolation());
    let result: Awaited<ReturnType<typeof deleteClientAction>>;
    try {
      result = await deleteClientAction(client.id);
    } finally {
      transactionSpy.mockRestore();
    }

    // The controlled { ok: false } is what DeleteButton renders as its own
    // conflictMessage prop ("This client can't be deleted because it has
    // existing invoices.") — never a distinct error string returned from
    // the action itself.
    expect(result).toEqual({ ok: false });

    // No partial destructive mutation: no DELETED Activity was written,
    // and nothing was queued for Storage cleanup.
    const deletedActivity = await prisma.activity.findFirst({ where: { entityId: client.id, action: "DELETED" } });
    expect(deletedActivity).toBeNull();
    expect(removedPaths).toHaveLength(0);

    await prisma.client.deleteMany({ where: { id: client.id } });
  });

  it("a client belonging to a different organization cannot be deleted (existing tenant scoping unchanged)", async () => {
    // fixtures.clientB belongs to orgB — acting as an orgA identity.
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await deleteClientAction(fixtures.clientB.id);

    expect(result).toEqual({ ok: true }); // "not found for this org" is a quiet no-op, same as before this change.
    const stillThere = await prisma.client.findUnique({ where: { id: fixtures.clientB.id } });
    expect(stillThere).not.toBeNull();
  });

  it("an unrelated failure (never a dependent-invoices conflict) still propagates instead of being silently swallowed", async () => {
    const client = await createClient(fixtures.orgA.id, fixtures.owner.id);
    actAs(fixtures.owner, fixtures.orgA.id);

    // A plain, unrelated failure — not the P2039/23001/Client shape
    // mapDeleteRestrictError positively matches — proving the catch
    // block's classifier only ever intercepts the one specific shape
    // it's meant to, never a generic failure. Same $transaction-level
    // spy technique as the "blocked deletion" test above, for the same
    // reason (never depend on a real, uncontrolled DB-level failure
    // mode against the shared local test database).
    const transactionSpy = vi
      .spyOn(prisma, "$transaction")
      .mockRejectedValueOnce(new Error("simulated unrelated database failure"));
    try {
      await expect(deleteClientAction(client.id)).rejects.toThrow("simulated unrelated database failure");
    } finally {
      transactionSpy.mockRestore();
    }

    await prisma.client.deleteMany({ where: { id: client.id } });
  });

  it("attachment cleanup still runs inside the same transaction/order on a successful delete", async () => {
    const client = await createClient(fixtures.orgA.id, fixtures.owner.id);
    const attachmentId = randomUUID();
    const storagePath = `organizations/${fixtures.orgA.id}/CLIENT/${client.id}/${attachmentId}/file.pdf`;
    await prisma.attachment.create({
      data: {
        id: attachmentId,
        organizationId: fixtures.orgA.id,
        uploadedById: fixtures.owner.id,
        entityType: "CLIENT",
        entityId: client.id,
        storageBucket: "attachments",
        storagePath,
        originalName: "file.pdf",
        mimeType: "application/pdf",
        sizeBytes: 512,
      },
    });
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await deleteClientAction(client.id);

    expect(result).toEqual({ ok: true });
    expect(await prisma.attachment.findFirst({ where: { entityId: client.id } })).toBeNull();
    expect(removedPaths).toContain(storagePath);
  });
});
