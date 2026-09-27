import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { Role } from "@/generated/prisma/enums";

/**
 * PGlite Transaction Recovery — regression for the connection-reuse
 * defect `src/lib/prisma.ts`'s own PGLITE_TEST_DB facade works around
 * (see that file's own doc comment on `createPgliteRecoveryFacade`):
 * `@prisma/adapter-pg`'s `PgTransaction.rollback()` releases its pg-pool
 * client with no error argument, so an aborted transaction's connection
 * is recycled as healthy — under PGlite's single-connection cap, the
 * very next query anywhere in the process could previously be handed a
 * stale, wrongly-shaped result left over from that abort (reproduced
 * directly during this fix's own design audit: a `Membership` read
 * received back a complete `User`-shaped row).
 *
 * This is deliberately NOT timing-dependent: every iteration below
 * genuinely aborts a real transaction (a real `Membership.userId`
 * foreign-key violation, the exact shape `current-user.ts`'s own F1
 * recovery path already handles), then immediately issues a distinct,
 * differently-shaped query and asserts its result is both the CORRECT
 * model shape and the correct value — proving the next query never
 * received the aborted transaction's own leftover data, on every single
 * iteration, not just probabilistically.
 */

let createdOrgIds: string[] = [];
let createdUserIds: string[] = [];

afterEach(async () => {
  if (createdOrgIds.length > 0) {
    // Membership cascades from Organization (schema.prisma onDelete: Cascade).
    await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  }
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  createdOrgIds = [];
  createdUserIds = [];
});

describe("Prisma PGlite transaction recovery", () => {
  it("a genuinely-aborted transaction never poisons the next query's result shape, across many iterations", async () => {
    const ITERATIONS = 60;

    for (let i = 0; i < ITERATIONS; i++) {
      const owner = await prisma.user.create({
        data: { id: randomUUID(), name: `Recovery Owner ${i}`, email: `recovery-owner-${i}-${randomUUID()}@test.local` },
      });
      createdUserIds.push(owner.id);
      const org = await prisma.organization.create({
        data: { name: `Recovery Org ${i}`, slug: `recovery-org-${i}-${randomUUID()}` },
      });
      createdOrgIds.push(org.id);
      await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, role: Role.OWNER } });

      // The poisoning operation: a real Membership.userId P2003 — the
      // exact shape current-user.ts's own isMembershipUserForeignKeyViolation
      // recognizes — referencing a user id that was deliberately never
      // created.
      const ghostUserId = randomUUID();
      let rejected = false;
      try {
        await prisma.$transaction(async (tx) => {
          await tx.membership.create({ data: { userId: ghostUserId, organizationId: org.id, role: Role.OWNER } });
        });
      } catch (err) {
        rejected = true;
        // The original error must survive unchanged — recovery is
        // cleanup after the fact, never a swallowed/retried/rewrapped
        // rejection.
        expect(err).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
        expect((err as Prisma.PrismaClientKnownRequestError).code).toBe("P2003");
      }
      expect(rejected).toBe(true);

      // The victim query: immediately after, a plain, differently-shaped
      // read for the REAL owner — must return exactly this iteration's
      // own Membership, never a stale/wrongly-shaped result from the
      // aborted transaction above.
      const result = await prisma.membership.findFirst({
        where: { userId: owner.id, role: Role.OWNER },
        select: { organizationId: true },
      });
      expect(result).not.toBeNull();
      expect(result).toEqual({ organizationId: org.id });
    }
  });
});

/**
 * Proxy compatibility — the facade must not break the repo's own,
 * pre-existing `vi.spyOn(prisma, "$transaction")` convention (used across
 * ~6 integration files to simulate an application-level rejection with no
 * real DB interaction at all). This is a real reflection/mocking
 * pattern, not incidental: Vitest's own spy implementation requires
 * either an own-property descriptor or a `key in object` match before it
 * will install, and installs/restores via plain `Object.defineProperty`/
 * `Reflect.deleteProperty` on the object it's given.
 */
describe("Prisma PGlite recovery facade — vi.spyOn compatibility", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("A. Object.getOwnPropertyDescriptor / `in` reflection sees $transaction as present", () => {
    expect("$transaction" in prisma).toBe(true);
  });

  it("B. vi.spyOn(prisma, \"$transaction\") installs, observes, and restores cleanly", async () => {
    const spy = vi.spyOn(prisma, "$transaction");
    const owner = await prisma.user.create({
      data: { id: randomUUID(), name: "Spy Basic Owner", email: `spy-basic-${randomUUID()}@test.local` },
    });
    createdUserIds.push(owner.id);
    const org = await prisma.organization.create({
      data: { name: "Spy Basic Org", slug: `spy-basic-org-${randomUUID()}` },
    });
    createdOrgIds.push(org.id);

    await prisma.$transaction(async (tx) => {
      await tx.membership.create({ data: { userId: owner.id, organizationId: org.id, role: Role.OWNER } });
    });

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();

    // Restored: ordinary calls no longer go through the spy.
    const membership = await prisma.membership.findFirst({ where: { userId: owner.id } });
    expect(membership).not.toBeNull();
  });

  it("C. a spied rejection never triggers real connection recovery, and the facade keeps working normally once restored", async () => {
    const spy = vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("simulated rejection, no real DB involved"));

    await expect(prisma.$transaction(async () => {})).rejects.toThrow("simulated rejection, no real DB involved");
    spy.mockRestore();

    // Post-restore: a genuinely-aborted real transaction still triggers
    // real recovery correctly, and the very next query is unaffected —
    // proving the spy's own (fully synthetic) rejection above left no
    // residual state behind.
    const owner = await prisma.user.create({
      data: { id: randomUUID(), name: "Post Spy Owner", email: `post-spy-${randomUUID()}@test.local` },
    });
    createdUserIds.push(owner.id);
    const org = await prisma.organization.create({
      data: { name: "Post Spy Org", slug: `post-spy-org-${randomUUID()}` },
    });
    createdOrgIds.push(org.id);
    await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, role: Role.OWNER } });

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.membership.create({ data: { userId: randomUUID(), organizationId: org.id, role: Role.OWNER } });
      }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);

    const result = await prisma.membership.findFirst({
      where: { userId: owner.id, role: Role.OWNER },
      select: { organizationId: true },
    });
    expect(result).toEqual({ organizationId: org.id });
  });
});
