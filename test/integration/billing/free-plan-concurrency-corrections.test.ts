import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { startIsolatedDatabase, stopIsolatedDatabase, deployFullMigrationHistory } from "../../support/isolated-postgres";
import { bootstrapOrganizationStatusDefinitions } from "@/lib/custom-statuses/bootstrap";

const REPO_ROOT = new URL("../../..", import.meta.url).pathname;

/**
 * Aqenra Free plan — concurrency CORRECTION verification.
 *
 * The earlier concurrency suite (free-plan-active-limit-concurrency.test.ts)
 * only ever asserted `expect([1, 2]).toContain(committedCount)` — a shape
 * that cannot, by construction, prove a strict limit: it passes identically
 * whether the race is closed or wide open. This file replaces that framing
 * for the four dimensions this correction task actually fixed with a hard
 * `=== 1` assertion, backed by a real, per-organization Postgres advisory
 * lock (src/lib/billing/enforcement.ts's lockOrganizationForCapacityCheck,
 * src/lib/billing/storage-reservation.ts's own lock) rather than hoping
 * timing alone keeps the count under two.
 *
 * Every test here drives the REAL production functions
 * (assertCanInviteMember, assertCanCreateClient, assertCanIncreaseActiveProjects,
 * updateCustomStatusDefinition, createClientCore, reserveStorageBytes)
 * against an isolated PGlite instance reachable over a real Postgres
 * wire-protocol socket with `maxConnections: 5` — the same harness the
 * earlier suite used, still not a true multi-process Postgres cluster (none
 * available in this sandbox), but genuinely multiple independent socket
 * connections, not the shared integration suite's single-connection
 * (`max: 1`) database, which can never exercise real interleaving at all.
 *
 * Each "fixed" test below deliberately does NOT use an artificial barrier:
 * with the real lock in place, two concurrent calls for the same
 * organization/dimension are fully serialized by Postgres itself (the
 * second blocks until the first's whole transaction commits or rolls
 * back) — forcing an additional barrier on top of that would deadlock,
 * since the second call's own check could never complete while blocked on
 * the lock. The RESULT is deterministic because of the lock, not because
 * of favorable timing, which is exactly what makes a plain `Promise.all`
 * sufficient here (and is itself part of the proof: a flaky, timing-
 * dependent result across repeated runs would indicate the lock isn't
 * actually serializing the two calls).
 *
 * Each "negative control" test reproduces the EXACT pre-fix code shape —
 * a plain, unlocked `getOrganizationEntitlements` read, decide, then write
 * — with an explicit synchronization barrier forcing both calls' reads to
 * land before either call's write, deterministically exercising the
 * dangerous interleaving the old code could previously fall into (rather
 * than hoping an unsynchronized Promise.all happens to interleave that
 * way). This proves two things at once: the race genuinely existed before
 * this fix, and this test file's own methodology would have caught it.
 */

async function setupIsolatedFreePlanOrg(
  prisma: PrismaClient,
  label: string,
): Promise<{ orgId: string; ownerId: string; clientId: string }> {
  const owner = await prisma.user.create({
    data: { id: randomUUID(), email: `cc-${label}-${randomUUID().slice(0, 8)}@test.local`, name: `CC Owner ${label}` },
  });
  const org = await prisma.organization.create({
    data: { name: `CC Org ${label}`, slug: `cc-org-${label}-${randomUUID().slice(0, 8)}` },
  });
  await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });
  const now = new Date();
  await prisma.subscription.create({
    data: { organizationId: org.id, planKey: "FREE", status: "ACTIVE", trialStartedAt: now, trialEndsAt: now },
  });
  const client = await prisma.client.create({
    data: { name: `CC Client ${label}`, userId: owner.id, organizationId: org.id },
  });
  return { orgId: org.id, ownerId: owner.id, clientId: client.id };
}

type AttemptOutcome = "committed" | "rejected";

async function withBarrier<T>(fns: [(arrive: () => Promise<void>) => Promise<T>, (arrive: () => Promise<void>) => Promise<T>]): Promise<[T, T]> {
  let resolveA!: () => void;
  let resolveB!: () => void;
  const arrivedA = new Promise<void>((resolve) => (resolveA = resolve));
  const arrivedB = new Promise<void>((resolve) => (resolveB = resolve));
  const arriveA = async () => {
    resolveA();
    await arrivedB;
  };
  const arriveB = async () => {
    resolveB();
    await arrivedA;
  };
  return Promise.all([fns[0](arriveA), fns[1](arriveB)]) as Promise<[T, T]>;
}

describe("Aqenra Free plan — concurrency corrections (real multi-connection, deterministic)", () => {
  let activeCleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (activeCleanup) {
      await activeCleanup();
      activeCleanup = undefined;
    }
  });

  async function openIsolatedPrisma(): Promise<PrismaClient> {
    const database = await startIsolatedDatabase();
    await deployFullMigrationHistory(database.databaseUrl, REPO_ROOT);
    const adapter = new PrismaPg({ connectionString: database.databaseUrl });
    const prisma = new PrismaClient({ adapter });
    activeCleanup = async () => {
      await prisma.$disconnect();
      await stopIsolatedDatabase(database);
    };
    return prisma;
  }

  // ---------------------------------------------------------------------
  // Members
  // ---------------------------------------------------------------------

  it("FIXED: two concurrent invites for the single remaining FREE seat — exactly one commits", async () => {
    const prisma = await openIsolatedPrisma();
    const { orgId, ownerId } = await setupIsolatedFreePlanOrg(prisma, "members-fixed");
    const { assertCanInviteMember } = await import("@/lib/billing/enforcement");

    async function attempt(email: string): Promise<AttemptOutcome> {
      try {
        await prisma.$transaction(async (tx) => {
          await assertCanInviteMember(orgId, tx);
          await tx.invitation.create({
            data: {
              organizationId: orgId,
              email,
              role: "MEMBER",
              token: randomUUID(),
              status: "PENDING",
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              invitedById: ownerId,
            },
          });
        });
        return "committed";
      } catch {
        return "rejected";
      }
    }

    // The org has exactly one real seat free (owner only, FREE maxMembers
    // 2) — this is the only remaining-slot state these two attempts race
    // over; a second round would need its own fresh headroom, not
    // reused here, since the first round's own winner already consumes
    // the only slot that existed.
    const results = await Promise.all([
      attempt(`a-${randomUUID().slice(0, 6)}@test.local`),
      attempt(`b-${randomUUID().slice(0, 6)}@test.local`),
    ]);
    const committedCount = results.filter((r) => r === "committed").length;
    expect(committedCount).toBe(1);

    const invitationCount = await prisma.invitation.count({ where: { organizationId: orgId, status: "PENDING" } });
    expect(invitationCount).toBe(1);
  }, 30_000);

  it("NEGATIVE CONTROL: the identical pre-fix shape (plain read, no lock) lets both invites commit when their reads are forced to overlap", async () => {
    const prisma = await openIsolatedPrisma();
    const { orgId, ownerId } = await setupIsolatedFreePlanOrg(prisma, "members-control");
    const { getOrganizationEntitlements } = await import("@/lib/billing/entitlements");

    // Deliberately split into two independent round trips (read, THEN —
    // after the barrier — a separate write), rather than holding one
    // open transaction across the barrier wait: this isolated harness's
    // single embedded PGlite engine cannot service a second connection's
    // query while a first connection sits idle mid-transaction (confirmed
    // by direct reproduction — that shape reliably hung instead of
    // interleaving), a PGlite/this-harness limitation with no equivalent
    // in real Postgres, not a property of the race being demonstrated.
    // The race itself is identical either way: what matters is that both
    // reads land before either write, which this still guarantees deterministically.
    async function attemptWithoutLock(email: string, arrive: () => Promise<void>): Promise<AttemptOutcome> {
      // Deliberately the EXACT pre-fix assertCanInviteMember body, minus
      // the lock — a plain read, forced to overlap with the other
      // attempt's own read via the barrier, then a separate write.
      const entitlements = await getOrganizationEntitlements(orgId, { client: prisma });
      await arrive();
      if (!entitlements.canInviteMember) return "rejected";
      try {
        await prisma.invitation.create({
          data: {
            organizationId: orgId,
            email,
            role: "MEMBER",
            token: randomUUID(),
            status: "PENDING",
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            invitedById: ownerId,
          },
        });
        return "committed";
      } catch {
        return "rejected";
      }
    }

    const [a, b] = await withBarrier([
      (arrive) => attemptWithoutLock(`control-a-${randomUUID().slice(0, 6)}@test.local`, arrive),
      (arrive) => attemptWithoutLock(`control-b-${randomUUID().slice(0, 6)}@test.local`, arrive),
    ]);
    const committedCount = [a, b].filter((r) => r === "committed").length;

    // The org has exactly one real seat free (owner only, FREE maxMembers
    // 2) — both attempts' reads were forced to observe that same "one
    // seat free" state before either wrote, so without the lock, BOTH
    // commit: a real, forced oversubscription (3 "members" worth of
    // commitment for a 2-seat plan), proving the race this correction
    // fixes was genuine, and that this file's own methodology detects it.
    expect(committedCount).toBe(2);
  }, 30_000);

  // ---------------------------------------------------------------------
  // Clients — including the cross-entry-point angle (interactive vs. import)
  // ---------------------------------------------------------------------

  it("FIXED: two concurrent client creates for the single remaining FREE client slot — exactly one commits", async () => {
    const prisma = await openIsolatedPrisma();
    const { orgId, ownerId } = await setupIsolatedFreePlanOrg(prisma, "clients-fixed");
    await bootstrapOrganizationStatusDefinitions(prisma, orgId);
    await prisma.client.createMany({
      data: Array.from({ length: 23 }, (_, i) => ({ name: `Existing ${i}`, userId: ownerId, organizationId: orgId })),
    });
    // 24 clients exist (1 from setup + 23 here) — exactly one slot remains under 25.

    const { createClientCore } = await import("@/lib/clients/create-core");

    async function attempt(name: string, context: "interactive" | "import"): Promise<AttemptOutcome> {
      try {
        await prisma.$transaction(async (tx) => {
          await createClientCore(tx, {
            organizationId: orgId,
            userId: ownerId,
            actorName: "Concurrency Test",
            context,
            input: { name, company: null, email: null, phone: null, notes: null, billingLegalName: null, taxId: null, streetAddress: null, city: null, state: null, postalCode: null, country: null },
          });
        });
        return "committed";
      } catch {
        return "rejected";
      }
    }

    // Cross-entry-point: one request shaped like the interactive create
    // form, the other shaped like a CSV import row — both funnel through
    // the identical createClientCore chokepoint and must still serialize
    // against EACH OTHER, not just against their own kind.
    const results = await Promise.all([attempt("Manual Contender", "interactive"), attempt("Imported Contender", "import")]);
    const committedCount = results.filter((r) => r === "committed").length;
    expect(committedCount).toBe(1);

    const clientCount = await prisma.client.count({ where: { organizationId: orgId } });
    expect(clientCount).toBe(25);
  }, 30_000);

  // ---------------------------------------------------------------------
  // Active projects — including the cross-entry-point angle
  // (reactivation vs. custom-status reclassification)
  // ---------------------------------------------------------------------

  it("FIXED: two concurrent reactivations for the single remaining active-project slot — exactly one commits", async () => {
    const prisma = await openIsolatedPrisma();
    const { orgId, ownerId, clientId } = await setupIsolatedFreePlanOrg(prisma, "projects-fixed");

    await prisma.project.createMany({
      data: Array.from({ length: 4 }, (_, i) => ({
        name: `Active ${i}`,
        clientId,
        ownerId,
        organizationId: orgId,
        status: "IN_PROGRESS",
      })),
    });
    const toReactivate = await prisma.project.createManyAndReturn({
      data: Array.from({ length: 2 }, (_, i) => ({
        name: `Finished ${i}`,
        clientId,
        ownerId,
        organizationId: orgId,
        status: "COMPLETED",
      })),
    });

    const { assertCanIncreaseActiveProjects } = await import("@/lib/billing/enforcement");

    async function attempt(projectId: string): Promise<AttemptOutcome> {
      try {
        await prisma.$transaction(async (tx) => {
          await assertCanIncreaseActiveProjects(orgId, tx);
          await tx.project.update({ where: { id: projectId }, data: { status: "IN_PROGRESS" } });
        });
        return "committed";
      } catch {
        return "rejected";
      }
    }

    const results = await Promise.all(toReactivate.map((p) => attempt(p.id)));
    const committedCount = results.filter((r) => r === "committed").length;
    expect(committedCount).toBe(1);

    const activeCount = await prisma.project.count({ where: { organizationId: orgId, status: "IN_PROGRESS" } });
    expect(activeCount).toBe(5);
  }, 30_000);

  it("FIXED cross-entry-point: a project reactivation and a custom-status reclassification racing for the SAME last active slot — exactly one succeeds", async () => {
    const prisma = await openIsolatedPrisma();
    const { orgId, ownerId, clientId } = await setupIsolatedFreePlanOrg(prisma, "cross-fixed");
    await bootstrapOrganizationStatusDefinitions(prisma, orgId);

    // 4 already active — one slot remains.
    await prisma.project.createMany({
      data: Array.from({ length: 4 }, (_, i) => ({
        name: `Active ${i}`,
        clientId,
        ownerId,
        organizationId: orgId,
        status: "IN_PROGRESS",
      })),
    });
    // A finished project to reactivate directly.
    const [finished] = await prisma.project.createManyAndReturn({
      data: [{ name: "Finished Contender", clientId, ownerId, organizationId: orgId, status: "COMPLETED" }],
    });
    // A custom "Backlog" status, currently NOT counted as active, with
    // exactly one project assigned to it — reclassifying it to active
    // would add exactly 1 to the active count, the same increment the
    // reactivation above represents. Applying BOTH would reach 6, over
    // the limit of 5; applying either ALONE fits exactly.
    const backlog = await prisma.customStatusDefinition.create({
      data: {
        organizationId: orgId,
        entityType: "PROJECT",
        key: "backlog",
        label: "Backlog",
        color: "NEUTRAL",
        position: 10,
        isDefault: false,
        isSystem: false,
        countsAsActiveProject: false,
      },
    });
    await prisma.project.create({
      data: { name: "Backlogged", clientId, ownerId, organizationId: orgId, status: "PLANNING", statusDefinitionId: backlog.id },
    });

    const { assertCanIncreaseActiveProjects } = await import("@/lib/billing/enforcement");
    const { updateCustomStatusDefinition } = await import("@/lib/custom-statuses/definitions");

    async function reactivate(): Promise<AttemptOutcome> {
      try {
        await prisma.$transaction(async (tx) => {
          await assertCanIncreaseActiveProjects(orgId, tx);
          await tx.project.update({ where: { id: finished.id }, data: { status: "IN_PROGRESS" } });
        });
        return "committed";
      } catch {
        return "rejected";
      }
    }

    async function reclassify(): Promise<AttemptOutcome> {
      const result = await updateCustomStatusDefinition(orgId, backlog.id, { countsAsActiveProject: true });
      return result.ok ? "committed" : "rejected";
    }

    const [reactivationResult, reclassifyResult] = await Promise.all([reactivate(), reclassify()]);
    const committedCount = [reactivationResult, reclassifyResult].filter((r) => r === "committed").length;

    // Never both: the two entry points share the exact same
    // "active-projects" lock key, so whichever's transaction commits
    // first is the one whose own re-read the other then sees.
    expect(committedCount).toBe(1);

    // countActiveProjects (not a raw legacy `status` filter) is the
    // correct check here: if the WINNER is the reclassification, the
    // "Backlogged" project's own `status` column never changes (it stays
    // "PLANNING") — only its statusDefinition's countsAsActiveProject
    // does, which is exactly the real semantic countActiveProjects reads
    // (src/lib/billing/usage.ts). A raw `status: "IN_PROGRESS"` count
    // would silently under-count in that exact outcome.
    const { countActiveProjects } = await import("@/lib/billing/usage");
    const activeCount = await countActiveProjects(prisma, orgId);
    expect(activeCount).toBe(5);
  }, 30_000);

  it("NEGATIVE CONTROL: the identical pre-fix shape (plain, unlocked affected-count check) lets a reactivation and a reclassification both commit when forced to overlap", async () => {
    const prisma = await openIsolatedPrisma();
    const { orgId, ownerId, clientId } = await setupIsolatedFreePlanOrg(prisma, "cross-control");
    await bootstrapOrganizationStatusDefinitions(prisma, orgId);

    await prisma.project.createMany({
      data: Array.from({ length: 4 }, (_, i) => ({
        name: `Active ${i}`,
        clientId,
        ownerId,
        organizationId: orgId,
        status: "IN_PROGRESS",
      })),
    });
    const [finished] = await prisma.project.createManyAndReturn({
      data: [{ name: "Finished Contender", clientId, ownerId, organizationId: orgId, status: "COMPLETED" }],
    });
    const backlog = await prisma.customStatusDefinition.create({
      data: {
        organizationId: orgId,
        entityType: "PROJECT",
        key: "backlog",
        label: "Backlog",
        color: "NEUTRAL",
        position: 10,
        isDefault: false,
        isSystem: false,
        countsAsActiveProject: false,
      },
    });
    await prisma.project.create({
      data: { name: "Backlogged", clientId, ownerId, organizationId: orgId, status: "PLANNING", statusDefinitionId: backlog.id },
    });

    const { getOrganizationEntitlements } = await import("@/lib/billing/entitlements");

    // As with the members negative control above, each attempt is split
    // into an independent read round trip, THEN (after the barrier) an
    // independent write round trip — never one open transaction held
    // across the barrier wait, which this isolated harness's single
    // embedded PGlite engine cannot service a second connection's query
    // during (confirmed by direct reproduction). The race under test —
    // both reads landing before either write — is unaffected by this
    // split.
    async function reactivateWithoutLock(arrive: () => Promise<void>): Promise<AttemptOutcome> {
      const entitlements = await getOrganizationEntitlements(orgId, { client: prisma });
      await arrive();
      if (!entitlements.canIncreaseActiveProjects) return "rejected";
      try {
        await prisma.project.update({ where: { id: finished.id }, data: { status: "IN_PROGRESS" } });
        return "committed";
      } catch {
        return "rejected";
      }
    }

    async function reclassifyWithoutLock(arrive: () => Promise<void>): Promise<AttemptOutcome> {
      // Deliberately the EXACT pre-fix updateCustomStatusDefinition
      // reclassification body, minus the lock.
      const affectedCount = await prisma.project.count({ where: { organizationId: orgId, statusDefinitionId: backlog.id } });
      const entitlements = await getOrganizationEntitlements(orgId, { client: prisma });
      await arrive();
      if (
        entitlements.maxActiveProjects !== null &&
        entitlements.currentActiveProjects + affectedCount > entitlements.maxActiveProjects
      ) {
        return "rejected";
      }
      try {
        await prisma.customStatusDefinition.update({ where: { id: backlog.id }, data: { countsAsActiveProject: true } });
        return "committed";
      } catch {
        return "rejected";
      }
    }

    const [reactivationResult, reclassifyResult] = await withBarrier([reactivateWithoutLock, reclassifyWithoutLock]);
    const committedCount = [reactivationResult, reclassifyResult].filter((r) => r === "committed").length;

    // Both reads were forced to land before either write — without the
    // shared lock, both see "one slot free" and both commit, pushing the
    // real active count to 6 against a limit of 5.
    expect(committedCount).toBe(2);
    // countActiveProjects, not a raw `status` filter — see the FIXED
    // version of this same scenario above for exactly why.
    const { countActiveProjects } = await import("@/lib/billing/usage");
    const activeCount = await countActiveProjects(prisma, orgId);
    expect(activeCount).toBe(6);
  }, 30_000);

  // ---------------------------------------------------------------------
  // Storage reservation
  // ---------------------------------------------------------------------

  it("FIXED: two concurrent reservations that together would cross the 1 GiB ceiling, each individually fitting — exactly one commits", async () => {
    const prisma = await openIsolatedPrisma();
    const { orgId } = await setupIsolatedFreePlanOrg(prisma, "storage-fixed");

    const alreadyUsed = Math.round(0.85 * 1024 * 1024 * 1024);
    const uploadSize = Math.round(0.1 * 1024 * 1024 * 1024);
    await prisma.attachment.create({
      data: {
        organizationId: orgId,
        entityType: "CLIENT",
        entityId: randomUUID(),
        storageBucket: "attachments",
        storagePath: `test/${randomUUID()}`,
        originalName: "existing.pdf",
        mimeType: "application/pdf",
        sizeBytes: alreadyUsed,
      },
    });

    const { reserveStorageBytes, releaseStorageReservation } = await import("@/lib/billing/storage-reservation");

    async function attempt(): Promise<AttemptOutcome> {
      const result = await reserveStorageBytes(orgId, uploadSize, prisma);
      if (!result.ok) return "rejected";
      // Mirrors the real upload flow's own "reservation, then the real
      // write that makes it permanent" shape — here, directly creating
      // the Attachment row the reservation was standing in for, then
      // releasing the now-redundant reservation.
      await prisma.attachment.create({
        data: {
          organizationId: orgId,
          entityType: "CLIENT",
          entityId: randomUUID(),
          storageBucket: "attachments",
          storagePath: `test/${randomUUID()}`,
          originalName: "concurrent.pdf",
          mimeType: "application/pdf",
          sizeBytes: uploadSize,
        },
      });
      await releaseStorageReservation(result.reservationId, prisma);
      return "committed";
    }

    const results = await Promise.all([attempt(), attempt()]);
    const committedCount = results.filter((r) => r === "committed").length;
    expect(committedCount).toBe(1);

    const totalBytes = await prisma.attachment.aggregate({ where: { organizationId: orgId }, _sum: { sizeBytes: true } });
    expect(totalBytes._sum.sizeBytes).toBe(alreadyUsed + uploadSize);

    const remainingReservations = await prisma.storageReservation.count({ where: { organizationId: orgId } });
    expect(remainingReservations).toBe(0); // the winner released its own; the loser never created one
  }, 30_000);

  it("NEGATIVE CONTROL: the identical pre-fix shape (plain, unlocked storage check) lets both uploads commit when forced to overlap, overshooting the ceiling", async () => {
    const prisma = await openIsolatedPrisma();
    const { orgId } = await setupIsolatedFreePlanOrg(prisma, "storage-control");

    const alreadyUsed = Math.round(0.85 * 1024 * 1024 * 1024);
    const uploadSize = Math.round(0.1 * 1024 * 1024 * 1024);
    const maxBytes = 1 * 1024 * 1024 * 1024;
    await prisma.attachment.create({
      data: {
        organizationId: orgId,
        entityType: "CLIENT",
        entityId: randomUUID(),
        storageBucket: "attachments",
        storagePath: `test/${randomUUID()}`,
        originalName: "existing.pdf",
        mimeType: "application/pdf",
        sizeBytes: alreadyUsed,
      },
    });

    const { getOrganizationEntitlements } = await import("@/lib/billing/entitlements");

    async function attemptWithoutReservation(arrive: () => Promise<void>): Promise<AttemptOutcome> {
      // Deliberately the EXACT pre-fix assertCanUploadAttachment shape —
      // a plain read with no reservation, no lock.
      const entitlements = await getOrganizationEntitlements(orgId);
      await arrive();
      if (!entitlements.canUploadBytes(uploadSize)) return "rejected";
      await prisma.attachment.create({
        data: {
          organizationId: orgId,
          entityType: "CLIENT",
          entityId: randomUUID(),
          storageBucket: "attachments",
          storagePath: `test/${randomUUID()}`,
          originalName: "concurrent.pdf",
          mimeType: "application/pdf",
          sizeBytes: uploadSize,
        },
      });
      return "committed";
    }

    const [a, b] = await withBarrier([attemptWithoutReservation, attemptWithoutReservation]);
    const committedCount = [a, b].filter((r) => r === "committed").length;
    expect(committedCount).toBe(2);

    const totalBytes = await prisma.attachment.aggregate({ where: { organizationId: orgId }, _sum: { sizeBytes: true } });
    expect(totalBytes._sum.sizeBytes).toBeGreaterThan(maxBytes); // the ceiling was genuinely overshot
  }, 30_000);
});
