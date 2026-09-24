import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { startWithSampleDataAction } from "@/app/(dashboard)/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { testEmail, testSlug } from "../../support/run-id";

/**
 * Demo Vs Real Workspace Separation §5-§8 — exercises the real,
 * unmodified startWithSampleDataAction end to end against the real test
 * database. Only Supabase Auth/cookies() are mocked (test/integration/
 * setup-mocks.ts); role/organization resolution, the atomic isDemo claim,
 * the emptiness guard, and every Client/Project/Task/Invoice write run for
 * real, inside a real Postgres transaction.
 *
 * "Double-click/retry cannot duplicate sample data" is proven here as a
 * sequential retry (call, then immediately call again) rather than a true
 * concurrent Promise.all — the underlying guarantee (Postgres row-level
 * locking on the atomic `UPDATE ... WHERE isDemo = false` claim) is a
 * standard, well-established database property this suite relies on, not
 * something worth re-proving against this environment's own
 * PGlite-backed test Postgres (see docs/testing.md's own documented
 * connection-reuse-race harness limitation for exactly why a genuinely
 * parallel two-transaction test against this harness would be a poor,
 * flake-prone way to exercise this). The sequential test below still
 * fully proves the guard logic itself is correct.
 */

type EmptyOrg = { organizationId: string; ownerId: string; ownerEmail: string };

async function createEmptyOrgWithOwner(label: string): Promise<EmptyOrg> {
  const ownerId = randomUUID();
  const ownerEmail = testEmail(`sample-data-${label}`, "test.local");
  await prisma.user.create({
    data: { id: ownerId, email: ownerEmail, name: `Sample Data Owner ${label}` },
  });
  const organization = await prisma.organization.create({
    data: { name: `Sample Data Test Org ${label}`, slug: testSlug(`sample-data-org-${label}`) },
  });
  await prisma.membership.create({
    data: { userId: ownerId, organizationId: organization.id, role: "OWNER" },
  });
  return { organizationId: organization.id, ownerId, ownerEmail };
}

async function cleanupEmptyOrg(org: EmptyOrg): Promise<void> {
  // Invoice.organizationId/clientId are both onDelete: Restrict (see
  // schema.prisma's own comments on those fields) — same deletion order
  // test/fixtures/seed.ts's own cleanupTestData() already establishes:
  // Invoice, then Client (Project/Task cascade off Client), then
  // Organization, then the User(s).
  await prisma.invoice.deleteMany({ where: { organizationId: org.organizationId } });
  await prisma.client.deleteMany({ where: { organizationId: org.organizationId } });
  await prisma.organization.deleteMany({ where: { id: org.organizationId } });
  await prisma.user.deleteMany({ where: { id: org.ownerId } });
}

describe("startWithSampleDataAction", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(() => {
    resetAuthMock();
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("OWNER may start sample data on a genuinely empty workspace", async () => {
    const org = await createEmptyOrgWithOwner(randomUUID().slice(0, 8));
    actAs({ id: org.ownerId, email: org.ownerEmail }, org.organizationId);

    const result = await startWithSampleDataAction();
    expect(result).toEqual({ ok: true });

    await cleanupEmptyOrg(org);
  });

  it("ADMIN cannot start sample data", async () => {
    actAs(fixtures.admin, fixtures.orgA.id);
    const result = await startWithSampleDataAction();
    expect(result).toEqual({ ok: false, message: "Only the workspace owner can start with sample data." });
  });

  it("MEMBER cannot start sample data", async () => {
    actAs(fixtures.member, fixtures.orgA.id);
    const result = await startWithSampleDataAction();
    expect(result).toEqual({ ok: false, message: "Only the workspace owner can start with sample data." });
  });

  it("only affects the caller's own active organization — a second, unrelated empty org is left untouched", async () => {
    const orgA = await createEmptyOrgWithOwner(`${randomUUID().slice(0, 8)}-a`);
    const orgB = await createEmptyOrgWithOwner(`${randomUUID().slice(0, 8)}-b`);
    actAs({ id: orgA.ownerId, email: orgA.ownerEmail }, orgA.organizationId);

    const result = await startWithSampleDataAction();
    expect(result).toEqual({ ok: true });

    const orgARow = await prisma.organization.findUnique({ where: { id: orgA.organizationId } });
    const orgBRow = await prisma.organization.findUnique({ where: { id: orgB.organizationId } });
    expect(orgARow?.isDemo).toBe(true);
    expect(orgBRow?.isDemo).toBe(false);

    const orgBClientCount = await prisma.client.count({ where: { organizationId: orgB.organizationId } });
    expect(orgBClientCount).toBe(0);

    await cleanupEmptyOrg(orgA);
    await cleanupEmptyOrg(orgB);
  });

  it("a non-empty workspace is rejected, and nothing is left partially changed", async () => {
    // fixtures.orgA already has a real Client/Project/Task/Invoice from
    // seedTestData() itself — a genuine non-empty real workspace, no
    // extra setup needed.
    actAs(fixtures.owner, fixtures.orgA.id);

    const beforeCounts = {
      clients: await prisma.client.count({ where: { organizationId: fixtures.orgA.id } }),
      projects: await prisma.project.count({ where: { organizationId: fixtures.orgA.id } }),
      tasks: await prisma.task.count({ where: { organizationId: fixtures.orgA.id } }),
      invoices: await prisma.invoice.count({ where: { organizationId: fixtures.orgA.id } }),
    };
    expect(beforeCounts.clients).toBeGreaterThan(0);

    const result = await startWithSampleDataAction();
    expect(result).toEqual({
      ok: false,
      message: "Sample data can only be added to a brand-new, empty workspace.",
    });

    // The atomic isDemo claim must have been rolled back along with the
    // rejected insert attempt — never left true with no sample data to
    // back it (§8's own explicit invariant).
    const orgRow = await prisma.organization.findUnique({ where: { id: fixtures.orgA.id } });
    expect(orgRow?.isDemo).toBe(false);

    const afterCounts = {
      clients: await prisma.client.count({ where: { organizationId: fixtures.orgA.id } }),
      projects: await prisma.project.count({ where: { organizationId: fixtures.orgA.id } }),
      tasks: await prisma.task.count({ where: { organizationId: fixtures.orgA.id } }),
      invoices: await prisma.invoice.count({ where: { organizationId: fixtures.orgA.id } }),
    };
    expect(afterCounts).toEqual(beforeCounts);
  });

  it("a retried call after a successful one is rejected cleanly, never duplicating sample data", async () => {
    const org = await createEmptyOrgWithOwner(randomUUID().slice(0, 8));
    actAs({ id: org.ownerId, email: org.ownerEmail }, org.organizationId);

    const first = await startWithSampleDataAction();
    expect(first).toEqual({ ok: true });

    const second = await startWithSampleDataAction();
    expect(second).toEqual({ ok: false, message: "This workspace already has sample data." });

    const clientCount = await prisma.client.count({ where: { organizationId: org.organizationId } });
    const invoiceCount = await prisma.invoice.count({ where: { organizationId: org.organizationId } });
    expect(clientCount).toBe(2);
    expect(invoiceCount).toBe(1);

    await cleanupEmptyOrg(org);
  });

  it("creates exactly the intended bounded sample dataset and marks the organization demo", async () => {
    const org = await createEmptyOrgWithOwner(randomUUID().slice(0, 8));
    actAs({ id: org.ownerId, email: org.ownerEmail }, org.organizationId);

    const result = await startWithSampleDataAction();
    expect(result).toEqual({ ok: true });

    const orgRow = await prisma.organization.findUnique({ where: { id: org.organizationId } });
    expect(orgRow?.isDemo).toBe(true);

    const clients = await prisma.client.findMany({ where: { organizationId: org.organizationId } });
    const projects = await prisma.project.findMany({ where: { organizationId: org.organizationId } });
    const tasks = await prisma.task.findMany({ where: { organizationId: org.organizationId } });
    const invoices = await prisma.invoice.findMany({ where: { organizationId: org.organizationId } });

    expect(clients).toHaveLength(2);
    expect(projects).toHaveLength(1);
    expect(tasks).toHaveLength(3);
    expect(invoices).toHaveLength(1);

    // No garbage/QA-style strings, no real-person-looking email domains —
    // the read-only audit's own §7 explicitly asked this dataset to avoid
    // both.
    for (const client of clients) {
      expect(client.email).toMatch(/\.example$/);
      expect(client.name).not.toMatch(/qweqweqwe|nose/i);
    }
    expect(projects[0]?.clientId).toBe(clients.find((c) => c.status === "ACTIVE")!.id);
    for (const task of tasks) {
      expect(task.projectId).toBe(projects[0]!.id);
    }
    expect(invoices[0]?.status).toBe("SENT");
    expect(invoices[0]?.amount.toFixed(2)).toBe("2400.00");

    // No overdue task: every task's own dueDate is either in the future or
    // already completed before its due date — matching §7's explicit
    // "avoid excessive/random overdue items" instruction.
    const now = new Date();
    for (const task of tasks) {
      if (task.status !== "DONE" && task.dueDate) {
        expect(task.dueDate.getTime()).toBeGreaterThan(now.getTime());
      }
    }

    await cleanupEmptyOrg(org);
  });

  it("rejects an ADMIN attempt against a genuinely empty workspace without ever touching Organization.isDemo or creating any row", async () => {
    const org = await createEmptyOrgWithOwner(randomUUID().slice(0, 8));
    const adminId = randomUUID();
    const adminEmail = testEmail("sample-data-admin", "test.local");
    await prisma.user.create({
      data: { id: adminId, email: adminEmail, name: "Sample Data Admin" },
    });
    await prisma.membership.create({ data: { userId: adminId, organizationId: org.organizationId, role: "ADMIN" } });

    actAs({ id: adminId, email: adminEmail }, org.organizationId);
    const result = await startWithSampleDataAction();
    expect(result.ok).toBe(false);

    const orgRow = await prisma.organization.findUnique({ where: { id: org.organizationId } });
    expect(orgRow?.isDemo).toBe(false);
    const clientCount = await prisma.client.count({ where: { organizationId: org.organizationId } });
    expect(clientCount).toBe(0);

    await prisma.user.deleteMany({ where: { id: adminId } });
    await cleanupEmptyOrg(org);
  });
});
