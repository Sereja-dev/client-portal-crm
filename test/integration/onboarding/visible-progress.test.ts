import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/enums";
import { getVisibleOnboardingProgress } from "@/lib/onboarding/visible-progress";
import { startWithSampleDataAction } from "@/app/(dashboard)/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { testEmail, testSlug } from "../../support/run-id";

/**
 * Onboarding Redesign. Exercises the real, unmodified
 * getVisibleOnboardingProgress() against the real (test) Postgres —
 * mirrors test/integration/onboarding/progress.test.ts's own conventions
 * exactly for the legacy engine. This file covers only what's genuinely
 * DB-dependent (a real Invoice row driving the new hasInvoice signal, and
 * the real Start-with-sample-data action's own resulting progress) — the
 * full role/dependency/skip matrix is already covered at the pure-
 * function level in test/unit/onboarding-visible-progress.test.ts.
 */

describe("getVisibleOnboardingProgress", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("a real Invoice (no Task at all) drives the Task-or-Invoice step to COMPLETE", async () => {
    const ownerId = randomUUID();
    await prisma.user.create({
      data: { id: ownerId, email: testEmail("visible-progress-invoice", "test.local"), name: "Invoice Only Owner" },
    });
    const organization = await prisma.organization.create({
      data: { name: "Invoice Only Org", slug: testSlug("visible-progress-invoice-org") },
    });
    await prisma.membership.create({ data: { userId: ownerId, organizationId: organization.id, role: "OWNER" } });
    const client = await prisma.client.create({
      data: { organizationId: organization.id, userId: ownerId, name: "Invoice Only Client", status: "ACTIVE" },
    });
    await prisma.invoice.create({
      data: {
        organizationId: organization.id,
        clientId: client.id,
        invoiceNumber: "TEST-INV-0001",
        status: "DRAFT",
        amount: "100.00",
      },
    });

    const progress = await getVisibleOnboardingProgress(organization.id, Role.OWNER);
    const taskOrInvoice = progress.steps.find((s) => s.key === "CREATE_TASK")!;
    expect(taskOrInvoice.status).toBe("COMPLETE");

    await prisma.invoice.deleteMany({ where: { organizationId: organization.id } });
    await prisma.client.deleteMany({ where: { organizationId: organization.id } });
    await prisma.organization.deleteMany({ where: { id: organization.id } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
  });

  it("real Client/Project/Task/second-Membership rows (fixtures.orgA) drive every visible step to COMPLETE", async () => {
    // seedTestData() already gives orgA a real Client/Project/Task and
    // three real Memberships (owner/admin/member) — the same fixture the
    // legacy progress.test.ts's own equivalent test already relies on.
    // No OrganizationProfile exists for orgA, so Company Profile stays
    // NOT_STARTED — the one step this fixture never happens to complete.
    const progress = await getVisibleOnboardingProgress(fixtures.orgA.id, Role.OWNER);
    const byKey = Object.fromEntries(progress.steps.map((s) => [s.key, s]));
    expect(byKey.CREATE_CLIENT.status).toBe("COMPLETE");
    expect(byKey.CREATE_PROJECT.status).toBe("COMPLETE");
    expect(byKey.CREATE_TASK.status).toBe("COMPLETE");
    expect(byKey.INVITE_TEAMMATE.status).toBe("COMPLETE");
    expect(progress.completedCount).toBe(4);
  });

  describe("Start with sample data (locked spec §9)", () => {
    afterAll(() => resetAuthMock());

    it("19. a real sample-data-seeded workspace shows exactly 3 of 5, never falsely completing Company Profile or Invite", async () => {
      const ownerId = randomUUID();
      const ownerEmail = testEmail("visible-progress-sample-data", "test.local");
      await prisma.user.create({ data: { id: ownerId, email: ownerEmail, name: "Sample Data Owner" } });
      const organization = await prisma.organization.create({
        data: { name: "Sample Data Visible Progress Org", slug: testSlug("visible-progress-sample-data-org") },
      });
      await prisma.membership.create({ data: { userId: ownerId, organizationId: organization.id, role: "OWNER" } });

      actAs({ id: ownerId, email: ownerEmail }, organization.id);
      const result = await startWithSampleDataAction();
      expect(result).toEqual({ ok: true });

      const progress = await getVisibleOnboardingProgress(organization.id, Role.OWNER);
      expect(progress.completedCount).toBe(3);
      expect(progress.totalCount).toBe(5);
      const byKey = Object.fromEntries(progress.steps.map((s) => [s.key, s]));
      expect(byKey.CREATE_CLIENT.status).toBe("COMPLETE");
      expect(byKey.CREATE_PROJECT.status).toBe("COMPLETE");
      expect(byKey.CREATE_TASK.status).toBe("COMPLETE");
      expect(byKey.COMPANY_PROFILE.status).toBe("NOT_STARTED");
      expect(byKey.INVITE_TEAMMATE.status).toBe("NOT_STARTED");

      await prisma.invoice.deleteMany({ where: { organizationId: organization.id } });
      await prisma.client.deleteMany({ where: { organizationId: organization.id } });
      await prisma.organization.deleteMany({ where: { id: organization.id } });
      await prisma.user.deleteMany({ where: { id: ownerId } });
    });
  });
});
