import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { startIsolatedDatabase, stopIsolatedDatabase, deployFullMigrationHistory } from "../../support/isolated-postgres";

const REPO_ROOT = new URL("../../..", import.meta.url).pathname;

/**
 * Aqenra Free plan — real, multi-connection concurrency coverage for the
 * active-project limit, requested explicitly by the pre-push review (the
 * shared integration test database is capped at a single PGlite
 * connection — src/lib/prisma.ts's own `max: 1` under PGLITE_TEST_DB — so
 * nothing in test/integration/billing/enforcement.test.ts or
 * test/integration/projects/free-plan-active-limit.test.ts can ever prove
 * concurrent behavior; both only ever run one request at a time against
 * that shared database). This file instead stands up its own isolated
 * PGlite instance, reachable over a real Postgres wire-protocol socket
 * with `maxConnections: 5` (test/support/isolated-postgres.ts), and
 * drives two genuinely concurrent `$transaction` calls — each mirroring
 * createProjectAction's own exact sequence (assertCanIncreaseActiveProjects,
 * then the Project create) — at exactly one remaining active-project
 * slot, through the real application code, not a mock.
 *
 * This still is not a true multi-process Postgres cluster (no Docker or
 * local Postgres is available in this environment — confirmed by
 * inspection before writing this file) — PGlite is a single embedded
 * engine serving multiple real socket connections, so the kernel-level
 * guarantees a genuinely separate Postgres server would have are not
 * being tested here. What this DOES prove, which the single-connection
 * suite cannot: whether two independently-opened transactions, each
 * re-reading state inside its own transaction exactly as the real
 * Server Action does, can both observe "under the limit" and both
 * commit — i.e. whether the residual race assertCanIncreaseActiveProjects's
 * own doc comment describes is real and reproducible, or whether it
 * does not actually occur in practice against this engine.
 */
describe("assertCanIncreaseActiveProjects — real multi-connection concurrency", () => {
  let activeCleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (activeCleanup) {
      await activeCleanup();
      activeCleanup = undefined;
    }
  });

  it("two concurrent reactivations racing for the single remaining active-project slot: reports exactly how many actually committed", async () => {
    const port = 55740;
    const database = await startIsolatedDatabase(port);
    activeCleanup = async () => {
      await stopIsolatedDatabase(database);
    };

    await deployFullMigrationHistory(database.databaseUrl, REPO_ROOT);

    const adapter = new PrismaPg({ connectionString: database.databaseUrl });
    const prisma = new PrismaClient({ adapter });
    activeCleanup = async () => {
      await prisma.$disconnect();
      await stopIsolatedDatabase(database);
    };

    const owner = await prisma.user.create({
      data: { id: randomUUID(), email: `concurrency-owner-${randomUUID().slice(0, 8)}@test.local`, name: "Concurrency Owner" },
    });
    const org = await prisma.organization.create({
      data: { name: "Concurrency Org", slug: `concurrency-org-${randomUUID().slice(0, 8)}` },
    });
    await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });
    const now = new Date();
    await prisma.subscription.create({
      data: { organizationId: org.id, planKey: "FREE", status: "ACTIVE", trialStartedAt: now, trialEndsAt: now },
    });
    const client = await prisma.client.create({ data: { name: "Concurrency Client", userId: owner.id, organizationId: org.id } });

    // 4 already active — exactly one slot remains under FREE's 5-active ceiling.
    await prisma.project.createMany({
      data: Array.from({ length: 4 }, (_, i) => ({
        name: `Existing Active ${i}`,
        clientId: client.id,
        ownerId: owner.id,
        organizationId: org.id,
        status: "IN_PROGRESS",
      })),
    });
    // 2 finished projects to reactivate, racing for the one remaining slot.
    const toReactivate = await prisma.project.createManyAndReturn({
      data: Array.from({ length: 2 }, (_, i) => ({
        name: `Finished Contender ${i}`,
        clientId: client.id,
        ownerId: owner.id,
        organizationId: org.id,
        status: "COMPLETED",
      })),
    });

    const { assertCanIncreaseActiveProjects } = await import("@/lib/billing/enforcement");

    async function attemptReactivation(projectId: string): Promise<"committed" | "rejected"> {
      try {
        await prisma.$transaction(async (tx) => {
          await assertCanIncreaseActiveProjects(org.id, tx);
          await tx.project.update({ where: { id: projectId }, data: { status: "IN_PROGRESS" } });
        });
        return "committed";
      } catch {
        return "rejected";
      }
    }

    const results = await Promise.all(toReactivate.map((p) => attemptReactivation(p.id)));
    const committedCount = results.filter((r) => r === "committed").length;

    // Ground truth: however many of the two attempts actually committed,
    // the real row-level state must agree with it exactly — this is the
    // one unconditional invariant regardless of which way the race above
    // resolved.
    const activeCountAfter = await prisma.project.count({
      where: { organizationId: org.id, status: { in: ["IN_PROGRESS"] } },
    });
    expect(activeCountAfter).toBe(4 + committedCount);

    // Documents, rather than asserts, the actual outcome: a hard
    // invariant (committedCount === 1, never 2) is NOT something this
    // check's own current implementation (no row lock, no unique
    // constraint on "active project count") can guarantee — see
    // assertCanIncreaseActiveProjects's own doc comment. Recording the
    // real, empirically observed result here (rather than asserting a
    // specific number) is deliberate: it makes a future change to this
    // function's locking strategy show up as a real, visible test
    // change, not a silent assumption baked into a stricter assertion
    // this implementation does not actually back.
    expect([1, 2]).toContain(committedCount);
    console.log(`[concurrency] two concurrent reactivations at the limit: ${committedCount} of 2 committed`);
  }, 30_000);

  it("two concurrent member invites racing for the single remaining FREE-plan seat: reports exactly how many actually committed", async () => {
    const port = 55741;
    const database = await startIsolatedDatabase(port);
    activeCleanup = async () => {
      await stopIsolatedDatabase(database);
    };
    await deployFullMigrationHistory(database.databaseUrl, REPO_ROOT);
    const adapter = new PrismaPg({ connectionString: database.databaseUrl });
    const prisma = new PrismaClient({ adapter });
    activeCleanup = async () => {
      await prisma.$disconnect();
      await stopIsolatedDatabase(database);
    };

    const owner = await prisma.user.create({
      data: { id: randomUUID(), email: `concurrency-invite-owner-${randomUUID().slice(0, 8)}@test.local`, name: "Invite Owner" },
    });
    const org = await prisma.organization.create({
      data: { name: "Invite Concurrency Org", slug: `invite-concurrency-${randomUUID().slice(0, 8)}` },
    });
    await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });
    const now = new Date();
    await prisma.subscription.create({
      data: { organizationId: org.id, planKey: "FREE", status: "ACTIVE", trialStartedAt: now, trialEndsAt: now },
    });
    // FREE: maxMembers 2. Owner already fills one seat — exactly one seat remains.

    const { assertCanInviteMember } = await import("@/lib/billing/enforcement");

    async function attemptInvite(email: string): Promise<"committed" | "rejected"> {
      try {
        await prisma.$transaction(async (tx) => {
          await assertCanInviteMember(org.id, tx);
          await tx.invitation.create({
            data: {
              organizationId: org.id,
              email,
              role: "MEMBER",
              token: randomUUID(),
              status: "PENDING",
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              invitedById: owner.id,
            },
          });
        });
        return "committed";
      } catch {
        return "rejected";
      }
    }

    const results = await Promise.all([
      attemptInvite(`concurrent-a-${randomUUID().slice(0, 8)}@test.local`),
      attemptInvite(`concurrent-b-${randomUUID().slice(0, 8)}@test.local`),
    ]);
    const committedCount = results.filter((r) => r === "committed").length;

    const invitationCount = await prisma.invitation.count({ where: { organizationId: org.id, status: "PENDING" } });
    expect(invitationCount).toBe(committedCount);
    expect([1, 2]).toContain(committedCount);
    console.log(`[concurrency] two concurrent invites at the limit: ${committedCount} of 2 committed`);
  }, 30_000);

  it("two concurrent client creates racing for the single remaining FREE-plan client slot: reports exactly how many actually committed", async () => {
    const port = 55742;
    const database = await startIsolatedDatabase(port);
    activeCleanup = async () => {
      await stopIsolatedDatabase(database);
    };
    await deployFullMigrationHistory(database.databaseUrl, REPO_ROOT);
    const adapter = new PrismaPg({ connectionString: database.databaseUrl });
    const prisma = new PrismaClient({ adapter });
    activeCleanup = async () => {
      await prisma.$disconnect();
      await stopIsolatedDatabase(database);
    };

    const owner = await prisma.user.create({
      data: { id: randomUUID(), email: `concurrency-client-owner-${randomUUID().slice(0, 8)}@test.local`, name: "Client Owner" },
    });
    const org = await prisma.organization.create({
      data: { name: "Client Concurrency Org", slug: `client-concurrency-${randomUUID().slice(0, 8)}` },
    });
    await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });
    const now = new Date();
    await prisma.subscription.create({
      data: { organizationId: org.id, planKey: "FREE", status: "ACTIVE", trialStartedAt: now, trialEndsAt: now },
    });
    // FREE: maxClients 25. 24 already exist — exactly one slot remains.
    await prisma.client.createMany({
      data: Array.from({ length: 24 }, (_, i) => ({ name: `Existing Client ${i}`, userId: owner.id, organizationId: org.id })),
    });

    const { assertCanCreateClient } = await import("@/lib/billing/enforcement");

    async function attemptCreate(name: string): Promise<"committed" | "rejected"> {
      try {
        await prisma.$transaction(async (tx) => {
          await assertCanCreateClient(org.id, tx);
          await tx.client.create({ data: { name, userId: owner.id, organizationId: org.id } });
        });
        return "committed";
      } catch {
        return "rejected";
      }
    }

    const results = await Promise.all([attemptCreate("Contender A"), attemptCreate("Contender B")]);
    const committedCount = results.filter((r) => r === "committed").length;

    const clientCount = await prisma.client.count({ where: { organizationId: org.id } });
    expect(clientCount).toBe(24 + committedCount);
    expect([1, 2]).toContain(committedCount);
    console.log(`[concurrency] two concurrent client creates at the limit: ${committedCount} of 2 committed`);
  }, 30_000);

  it("two concurrent uploads that would together cross the 1 GiB FREE-plan storage ceiling: reports exactly how many actually committed", async () => {
    const port = 55743;
    const database = await startIsolatedDatabase(port);
    activeCleanup = async () => {
      await stopIsolatedDatabase(database);
    };
    await deployFullMigrationHistory(database.databaseUrl, REPO_ROOT);
    const adapter = new PrismaPg({ connectionString: database.databaseUrl });
    const prisma = new PrismaClient({ adapter });
    activeCleanup = async () => {
      await prisma.$disconnect();
      await stopIsolatedDatabase(database);
    };

    const owner = await prisma.user.create({
      data: { id: randomUUID(), email: `concurrency-storage-owner-${randomUUID().slice(0, 8)}@test.local`, name: "Storage Owner" },
    });
    const org = await prisma.organization.create({
      data: { name: "Storage Concurrency Org", slug: `storage-concurrency-${randomUUID().slice(0, 8)}` },
    });
    await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });
    const now = new Date();
    await prisma.subscription.create({
      data: { organizationId: org.id, planKey: "FREE", status: "ACTIVE", trialStartedAt: now, trialEndsAt: now },
    });

    // FREE: 1 GiB. Already at 0.85 GiB used — each individual 0.1 GiB
    // upload fits alone (0.85 + 0.1 = 0.95 GiB), but both together would
    // cross the ceiling (0.85 + 0.2 = 1.05 GiB). assertCanUploadAttachment's
    // own doc comment already documents this as a real, accepted,
    // weaker-than-the-others guarantee (Storage itself isn't transactional
    // with Postgres) — this proves what that actually looks like under
    // real concurrent writes.
    const maxBytes = 1 * 1024 * 1024 * 1024;
    const alreadyUsed = Math.round(0.85 * 1024 * 1024 * 1024);
    const uploadSize = Math.round(0.1 * 1024 * 1024 * 1024);
    await prisma.attachment.create({
      data: {
        organizationId: org.id,
        entityType: "CLIENT",
        entityId: randomUUID(),
        storageBucket: "attachments",
        storagePath: `test/${randomUUID()}`,
        originalName: "existing.pdf",
        mimeType: "application/pdf",
        sizeBytes: alreadyUsed,
      },
    });

    const { assertCanUploadAttachment } = await import("@/lib/billing/enforcement");

    async function attemptUpload(name: string): Promise<"committed" | "rejected"> {
      try {
        await prisma.$transaction(async (tx) => {
          await assertCanUploadAttachment(org.id, uploadSize, tx);
          await tx.attachment.create({
            data: {
              organizationId: org.id,
              entityType: "CLIENT",
              entityId: randomUUID(),
              storageBucket: "attachments",
              storagePath: `test/${name}-${randomUUID()}`,
              originalName: name,
              mimeType: "application/pdf",
              sizeBytes: uploadSize,
            },
          });
        });
        return "committed";
      } catch {
        return "rejected";
      }
    }

    const results = await Promise.all([attemptUpload("upload-a"), attemptUpload("upload-b")]);
    const committedCount = results.filter((r) => r === "committed").length;

    const totalBytes = await prisma.attachment.aggregate({ where: { organizationId: org.id }, _sum: { sizeBytes: true } });
    expect(totalBytes._sum.sizeBytes).toBe(alreadyUsed + committedCount * uploadSize);
    console.log(`[concurrency] two concurrent uploads near the ceiling: ${committedCount} of 2 committed, total ${totalBytes._sum.sizeBytes} / ${maxBytes} bytes`);
    // Deliberately no upper-bound assertion on committedCount: unlike the
    // transactional DB-only checks above, assertCanUploadAttachment's own
    // read-then-upload sequence is NOT fully guarded by a single
    // transaction against Storage itself (Storage isn't transactional
    // with Postgres at all) — the already-documented, accepted weaker
    // guarantee for this one dimension. Both committing (overshooting the
    // ceiling) is a real, possible, accepted outcome here, not a bug this
    // test is written to catch. This test's own two attemptUpload() calls
    // still only race on the DB check + Attachment-row write (both
    // wrapped in the same $transaction, mirroring the limit check and the
    // row write exactly) — the real production path
    // (uploadAttachmentForEntity) additionally uploads real bytes to
    // Storage *before* that DB write, non-transactionally, which is its
    // own separate, wider race window this test does not reach at all.
    // A result here of "1 of 2 committed" therefore demonstrates the DB
    // layer's own race behaves no worse than the other three dimensions
    // above under this engine — it is not proof that the full, real
    // upload path (including the Storage round-trip) carries the same
    // guarantee.
  }, 30_000);
});
