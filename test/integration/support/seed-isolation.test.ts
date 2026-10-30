import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getRunId } from "../../support/run-id";
import { TEST_EMAIL_DOMAIN } from "../../support/env";
import {
  seedTestData,
  cleanupTestData,
  cleanupSeededFixtures,
  newSeedRunId,
  type TestFixtures,
} from "../../fixtures/seed";

// Regression coverage for the E2E "fixture email collision cascade": in CI
// every seeded graph shared GITHUB_RUN_ID, so one User row that outlived a
// spec's cleanup (re-created by the app's getOrCreateUser() upsert when a late
// request still carrying the test session arrived after afterAll deleted the
// users) made the NEXT spec's seed fail with
// "Unique constraint failed on the fields: (email)" — and so on for ~96 files.

const seeded: TestFixtures[] = [];

async function seedIsolated(): Promise<TestFixtures> {
  const fixtures = await seedTestData(newSeedRunId());
  seeded.push(fixtures);
  return fixtures;
}

/** What the app does for a late request after the users were deleted. */
async function resurrectOwner(fixtures: TestFixtures): Promise<void> {
  await prisma.user.upsert({
    where: { id: fixtures.owner.id },
    update: {},
    create: { id: fixtures.owner.id, email: fixtures.owner.email, name: fixtures.owner.name },
  });
}

async function userExists(id: string): Promise<boolean> {
  return (await prisma.user.findUnique({ where: { id }, select: { id: true } })) !== null;
}

describe("E2E fixture identity and cleanup isolation", () => {
  afterAll(async () => {
    for (const fixtures of seeded) await cleanupSeededFixtures(fixtures, { settleMs: 0 });
  });

  it("newSeedRunId keeps the shared run id as the suffix, so run-scoped sweeps still match", () => {
    const a = newSeedRunId("424242");
    const b = newSeedRunId("424242");
    expect(a).toMatch(/^[0-9a-f]{8}-424242$/);
    expect(a).not.toBe(b);
  });

  it("two graphs seeded in the same run do not collide and carry distinct identities", async () => {
    const a = await seedIsolated();
    const b = await seedIsolated();
    expect(a.owner.email).not.toBe(b.owner.email);
    expect(a.orgA.slug).not.toBe(b.orgA.slug);
    expect(a.invoice.invoiceNumber).not.toBe(b.invoice.invoiceNumber);
    expect(a.owner.email.endsWith(`-${a.runId}@${TEST_EMAIL_DOMAIN}`)).toBe(true);
    expect(a.runId.endsWith(`-${getRunId()}`)).toBe(true);
  });

  it("a User re-created after cleanup cannot poison the next seed, and the next cleanup removes it", async () => {
    const first = await seedIsolated();
    await cleanupSeededFixtures(first, { settleMs: 0 });
    await resurrectOwner(first); // the leak that used to break every later spec
    expect(await userExists(first.owner.id)).toBe(true);

    const next = await seedIsolated(); // used to throw: Unique constraint failed on (email)
    expect(next.owner.email).not.toBe(first.owner.email);

    await cleanupSeededFixtures(first, { settleMs: 0 });
    expect(await userExists(first.owner.id)).toBe(false);
    expect(await userExists(next.owner.id)).toBe(true); // other graphs are never touched
    expect(await prisma.organization.count({ where: { id: { in: [next.orgA.id, next.orgB.id] } } })).toBe(2);
  });

  it("cleanup converges when a late request re-creates the User during the settle window", async () => {
    const fixtures = await seedIsolated();
    let resurrections = 0;
    await cleanupSeededFixtures(fixtures, {
      settleMs: 0,
      onSettle: async (sweep) => {
        if (sweep === 1) {
          await resurrectOwner(fixtures);
          resurrections += 1;
        }
      },
    });
    expect(resurrections).toBe(1);
    expect(await userExists(fixtures.owner.id)).toBe(false);
    expect(await prisma.organization.count({ where: { id: { in: [fixtures.orgA.id, fixtures.orgB.id] } } })).toBe(0);
  });

  it("a leak that never stops fails loudly and names the leaked rows instead of poisoning later specs", async () => {
    const fixtures = await seedIsolated();
    await expect(
      cleanupSeededFixtures(fixtures, {
        settleMs: 0,
        maxSweeps: 3,
        onSettle: () => resurrectOwner(fixtures),
      }),
    ).rejects.toThrow(new RegExp(`seed ${fixtures.runId} still present after 3 sweeps: user ${fixtures.owner.email}`));
    // the next seed is still unaffected
    const next = await seedIsolated();
    expect(next.owner.email).not.toBe(fixtures.owner.email);
  });

  it("only the graph's own seed-unique suffix is swept: other runs' and other seeds' identities survive", async () => {
    const target = await seedIsolated();
    const bystander = await seedIsolated();
    const foreignEmail = `owner-ffffffff-${getRunId()}@${TEST_EMAIL_DOMAIN}`;
    const foreign = await prisma.user.create({ data: { email: foreignEmail, name: "Other run" } });
    try {
      await cleanupSeededFixtures(target, { settleMs: 0 });
      expect(await userExists(foreign.id)).toBe(true);
      expect(await userExists(bystander.owner.id)).toBe(true);
    } finally {
      await prisma.user.delete({ where: { id: foreign.id } });
    }
  });

  it("the plain cleanupTestData used by integration suites is unchanged: it deletes by id only", async () => {
    const fixtures = await seedTestData(newSeedRunId());
    await cleanupTestData(fixtures);
    expect(await userExists(fixtures.owner.id)).toBe(false);
    expect(await prisma.organization.count({ where: { id: fixtures.orgA.id } })).toBe(0);
  });
});
