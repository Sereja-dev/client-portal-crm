import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { deleteProjectAction } from "@/app/(dashboard)/projects/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { resetStorageMock, removedPaths } from "../../support/storage-mock";

/**
 * Post-Hardening Residual Code Audit (P2) — deleteProjectAction's own
 * sibling to test/integration/clients/delete.test.ts. Same reasoning for
 * why the "blocked" and "unrelated failure" cases are simulated via
 * vi.spyOn(prisma, "$transaction") rather than a real seeded Invoice
 * triggering the real RESTRICT constraint inside prisma.$transaction() —
 * see that file's own header comment for the full explanation of the
 * confirmed local-test-database (PGlite) rollback limitation this avoids
 * depending on.
 */

const PROJECT_NAME_PREFIX = "DEL-Project";

function uniqueProjectName(): string {
  return `${PROJECT_NAME_PREFIX}-${randomUUID().slice(0, 8)}`;
}

async function createProject(organizationId: string, clientId: string, ownerId: string, name = uniqueProjectName()) {
  return prisma.project.create({ data: { name, organizationId, clientId, ownerId } });
}

// Quotes / Estimates Phase 2 — delete-conflict-mapper.ts's own
// extractRestrictChildTable() now requires the adapter error's cause.
// message/detail strings (the only place the real blocking child table
// name is available — see that file's own header comment) to positively
// disambiguate the violation, so the synthetic mock must carry both,
// cross-checked, exactly like a real Postgres RESTRICT violation does
// (Project's own only Restrict child is still Invoice alone — Quote has
// no projectId at all).
function realProjectRestrictViolation(): Prisma.PrismaClientKnownRequestError {
  const referencedId = randomUUID();
  return new Prisma.PrismaClientKnownRequestError("mock restrict violation", {
    code: "P2039",
    clientVersion: "test",
    meta: {
      modelName: "Project",
      driverAdapterError: {
        cause: {
          code: "23001",
          message: 'update or delete on table "Project" violates foreign key constraint "Invoice_projectId_fkey" on table "Invoice"',
          detail: `Key (id)=(${referencedId}) is referenced from table "Invoice".`,
        },
      },
    },
  });
}

describe("deleteProjectAction — blocked by existing invoices (Post-Hardening Residual Code Audit P2)", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(() => {
    resetAuthMock();
    resetStorageMock();
  });

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { name: { startsWith: PROJECT_NAME_PREFIX } } });
    await cleanupTestData(fixtures);
  });

  it("authorized deletion with no blocking invoices succeeds", async () => {
    const project = await createProject(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id);
    actAs(fixtures.owner, fixtures.orgA.id);

    const result = await deleteProjectAction(project.id);

    expect(result).toEqual({ ok: true });
    expect(await prisma.project.findUnique({ where: { id: project.id } })).toBeNull();
  });

  it("a blocked deletion (existing dependent invoices) returns the controlled dependency result, writes no Activity, and queues no Storage cleanup", async () => {
    const project = await createProject(fixtures.orgA.id, fixtures.clientA.id, fixtures.owner.id);
    actAs(fixtures.owner, fixtures.orgA.id);

    const transactionSpy = vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(realProjectRestrictViolation());
    let result: Awaited<ReturnType<typeof deleteProjectAction>>;
    try {
      result = await deleteProjectAction(project.id);
    } finally {
      transactionSpy.mockRestore();
    }

    // The controlled { ok: false } is what DeleteButton renders as its own
    // conflictMessage prop ("This project can't be deleted because it has
    // existing invoices.") — never a distinct error string returned from
    // the action itself.
    expect(result).toEqual({ ok: false });

    const deletedActivity = await prisma.activity.findFirst({ where: { entityId: project.id, action: "DELETED" } });
    expect(deletedActivity).toBeNull();
    expect(removedPaths).toHaveLength(0);

    await prisma.project.deleteMany({ where: { id: project.id } });
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

  it("an unrelated failure (never a dependent-invoices conflict) still propagates instead of being silently swallowed", async () => {
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
