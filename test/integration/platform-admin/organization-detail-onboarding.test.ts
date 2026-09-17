import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getOrganizationDetail } from "@/lib/platform-admin/queries/organization-detail";
import { setMockAuthUser, resetAuthMock } from "../../support/auth-mock";

/**
 * Platform Admin Onboarding (Organization Detail, read-only).
 * getOrganizationDetail()'s own execution-level authorization guard
 * (requirePlatformAdmin() as the first awaited operation, before any
 * Prisma call) is already fully proven, for this exact function, by
 * test/integration/platform-admin/execution-authorization.test.ts —
 * unchanged and unmodified by this feature, so it is not re-proven here.
 * This file instead proves the *content* correctness of the new
 * `onboarding` field specifically: organization scoping, correct
 * behavior across fresh/partial/complete/dismissed/suspended
 * organizations, the exact approved narrow shape, and — using this
 * repo's own established MARKERS technique — that no underlying
 * company-profile/payment/domain value ever reaches the returned view,
 * only the derived step status.
 *
 * Every organization here is created directly (never the shared
 * seedTestData() fixture, whose own orgA/orgB already carry real
 * clients/projects/memberships from other tests) so each onboarding
 * scenario below is fully isolated and under this file's own control.
 * Deleting an Organization row cascades OrganizationProfile/
 * OrganizationPaymentDetails/OrganizationDomainSettings/
 * OrganizationOnboardingStep automatically (all onDelete: Cascade), so
 * no separate cleanup call is needed for any of them.
 */

const PLATFORM_ADMIN_TEST_EMAIL = "platform-admin-onboarding-test@example.com";
const ORIGINAL_PLATFORM_ADMIN_EMAILS = process.env.PLATFORM_ADMIN_EMAILS;

const MARKERS = {
  legalName: "MARKER-LEGAL-NAME-must-never-leak",
  bankName: "MARKER-BANK-NAME-must-never-leak",
  accountHolder: "MARKER-ACCOUNT-HOLDER-must-never-leak",
  accountNumber: "MARKER-ACCOUNT-NUMBER-must-never-leak",
  swiftBic: "MARKERBIC",
  customDomain: `marker-domain-${randomUUID().slice(0, 8)}.example.test`,
};

const createdOrgIds: string[] = [];
// A client requires an owning User row (Client.userId, onDelete: Restrict) —
// tracked and cleaned up separately, since deleting an Organization does
// not cascade to User.
const createdUserIds: string[] = [];

beforeAll(() => {
  process.env.PLATFORM_ADMIN_EMAILS = PLATFORM_ADMIN_TEST_EMAIL;
});

afterAll(async () => {
  process.env.PLATFORM_ADMIN_EMAILS = ORIGINAL_PLATFORM_ADMIN_EMAILS;
  // Client.organizationId is onDelete: SetNull (not Cascade) — deleting
  // the Organization first would strand these Client rows (still
  // referencing their owning User via onDelete: Restrict) and then block
  // the User cleanup below. Deleting Clients explicitly first (which
  // cascades their own Projects, onDelete: Cascade) clears that path.
  await prisma.client.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

afterEach(() => {
  resetAuthMock();
});

function asPlatformAdmin() {
  setMockAuthUser({ id: randomUUID(), email: PLATFORM_ADMIN_TEST_EMAIL });
}

async function createOrg(name: string, overrides: { suspendedAt?: Date } = {}) {
  const org = await prisma.organization.create({
    data: { name, slug: `onboarding-test-${randomUUID()}`, ...overrides },
  });
  createdOrgIds.push(org.id);
  return org;
}

async function createOwnerUser() {
  const user = await prisma.user.create({
    data: { id: randomUUID(), name: "Onboarding Test Owner", email: `onboarding-owner-${randomUUID()}@example-marker-domain.test` },
  });
  createdUserIds.push(user.id);
  return user;
}

function stepByKey(steps: { key: string; status: string; required: boolean; label: string }[], key: string) {
  const step = steps.find((s) => s.key === key);
  if (!step) throw new Error(`step ${key} not found`);
  return step;
}

describe("getOrganizationDetail — onboarding is scoped to the requested organization only", () => {
  it("org A having a client never makes org B's CREATE_CLIENT step Complete", async () => {
    const orgA = await createOrg("Onboarding Org A");
    const orgB = await createOrg("Onboarding Org B");
    await prisma.client.create({
      data: { name: "A Client", organizationId: orgA.id, userId: (await createOwnerUser()).id },
    });

    asPlatformAdmin();
    const detailA = await getOrganizationDetail(orgA.id, new Date());
    const detailB = await getOrganizationDetail(orgB.id, new Date());

    expect(stepByKey(detailA!.onboarding.steps, "CREATE_CLIENT").status).toBe("COMPLETE");
    expect(stepByKey(detailB!.onboarding.steps, "CREATE_CLIENT").status).toBe("NOT_STARTED");
  });
});

describe("getOrganizationDetail — onboarding across fresh, partial, complete, and dismissed organizations", () => {
  it("a brand-new organization (zero rows anywhere) is handled safely: every step Not Started, 0%", async () => {
    const org = await createOrg("Fresh Org");

    asPlatformAdmin();
    const detail = await getOrganizationDetail(org.id, new Date());

    expect(detail!.onboarding.percent).toBe(0);
    expect(detail!.onboarding.completedCount).toBe(0);
    expect(detail!.onboarding.isComplete).toBe(false);
    expect(detail!.onboarding.isDismissed).toBe(false);
    for (const step of detail!.onboarding.steps) {
      expect(step.status).toBe("NOT_STARTED");
    }
  });

  it("partial progress is returned correctly: some steps Complete, others Not Started", async () => {
    const org = await createOrg("Partial Org");
    await prisma.organizationProfile.create({
      data: { organizationId: org.id, legalName: "Real Legal Name Inc.", country: "US", currency: "USD", timezone: "America/New_York" },
    });
    const owner = await createOwnerUser();
    await prisma.client.create({ data: { name: "Partial Org Client", organizationId: org.id, userId: owner.id } });

    asPlatformAdmin();
    const detail = await getOrganizationDetail(org.id, new Date());

    expect(stepByKey(detail!.onboarding.steps, "COMPANY_PROFILE").status).toBe("COMPLETE");
    expect(stepByKey(detail!.onboarding.steps, "CREATE_CLIENT").status).toBe("COMPLETE");
    expect(stepByKey(detail!.onboarding.steps, "PAYMENT_DETAILS").status).toBe("NOT_STARTED");
    expect(stepByKey(detail!.onboarding.steps, "DOMAIN_SETUP").status).toBe("NOT_STARTED");
    expect(detail!.onboarding.completedCount).toBeGreaterThan(0);
    expect(detail!.onboarding.completedCount).toBeLessThan(detail!.onboarding.totalCount);
  });

  it("a fully complete-and-dismissed organization preserves isComplete and isDismissed correctly", async () => {
    const org = await createOrg("Complete Org");
    const owner = await createOwnerUser();
    const client = await prisma.client.create({ data: { name: "Complete Org Client", organizationId: org.id, userId: owner.id } });
    await prisma.project.create({ data: { name: "A Project", organizationId: org.id, clientId: client.id, ownerId: owner.id } });
    await prisma.organizationProfile.create({
      data: { organizationId: org.id, legalName: "Complete Org Legal", country: "US", currency: "USD", timezone: "America/New_York" },
    });
    // Every skippable step explicitly skipped, WELCOME acknowledged, FINISH acknowledged.
    for (const step of ["WELCOME", "INDUSTRY_PRESET", "PAYMENT_DETAILS", "DOMAIN_SETUP", "CREATE_TASK", "INVITE_TEAMMATE", "INVITE_PORTAL_USER", "REVIEW_BILLING", "FINISH"] as const) {
      await prisma.organizationOnboardingStep.create({ data: { organizationId: org.id, step } });
    }

    asPlatformAdmin();
    const detail = await getOrganizationDetail(org.id, new Date());

    expect(detail!.onboarding.isComplete).toBe(true);
    expect(detail!.onboarding.isDismissed).toBe(true);
  });

  it("a suspended organization exposes the exact same onboarding progress as an equivalent active one", async () => {
    const activeOrg = await createOrg("Active Twin Org");
    const suspendedOrg = await createOrg("Suspended Twin Org", { suspendedAt: new Date() });
    const owner = await createOwnerUser();
    await prisma.client.create({ data: { name: "Active Twin Client", organizationId: activeOrg.id, userId: owner.id } });
    await prisma.client.create({ data: { name: "Suspended Twin Client", organizationId: suspendedOrg.id, userId: owner.id } });

    asPlatformAdmin();
    const activeDetail = await getOrganizationDetail(activeOrg.id, new Date());
    const suspendedDetail = await getOrganizationDetail(suspendedOrg.id, new Date());

    expect(suspendedDetail!.organization.suspendedAt).not.toBeNull();
    // Onboarding progress itself is identical in shape/content — suspension is orthogonal.
    expect(suspendedDetail!.onboarding.percent).toBe(activeDetail!.onboarding.percent);
    expect(stepByKey(suspendedDetail!.onboarding.steps, "CREATE_CLIENT").status).toBe(
      stepByKey(activeDetail!.onboarding.steps, "CREATE_CLIENT").status,
    );
    expect(stepByKey(suspendedDetail!.onboarding.steps, "CREATE_CLIENT").status).toBe("COMPLETE");
  });
});

describe("getOrganizationDetail — onboarding exposes only the approved narrow shape", () => {
  it("the top-level onboarding object contains exactly the approved summary fields", async () => {
    const org = await createOrg("Shape Check Org");

    asPlatformAdmin();
    const detail = await getOrganizationDetail(org.id, new Date());

    expect(Object.keys(detail!.onboarding).sort()).toEqual(
      ["steps", "requiredCompleted", "requiredTotal", "completedCount", "totalCount", "percent", "isComplete", "isDismissed"].sort(),
    );
  });

  it("every step object contains exactly {key, label, status, required} — no targetHref/actionable/blockedReason/skippable/completionSource", async () => {
    const org = await createOrg("Step Shape Check Org");

    asPlatformAdmin();
    const detail = await getOrganizationDetail(org.id, new Date());

    for (const step of detail!.onboarding.steps) {
      expect(Object.keys(step).sort()).toEqual(["key", "label", "status", "required"].sort());
    }
  });
});

describe("getOrganizationDetail — onboarding never leaks underlying sensitive values", () => {
  it("company-profile, payment, and domain field values never appear anywhere in the onboarding view, even though the corresponding steps show Complete", async () => {
    const org = await createOrg("Sensitive Values Org");
    await prisma.organizationProfile.create({
      data: { organizationId: org.id, legalName: MARKERS.legalName, country: "US", currency: "USD", timezone: "America/New_York" },
    });
    await prisma.organizationPaymentDetails.create({
      data: {
        organizationId: org.id,
        bankName: MARKERS.bankName,
        accountHolder: MARKERS.accountHolder,
        accountNumber: MARKERS.accountNumber,
        swiftBic: MARKERS.swiftBic,
      },
    });
    await prisma.organizationDomainSettings.create({
      data: { organizationId: org.id, customDomain: MARKERS.customDomain },
    });

    asPlatformAdmin();
    const detail = await getOrganizationDetail(org.id, new Date());

    // The steps genuinely resolved Complete (proving the markers really
    // did make their corresponding rows exist) ...
    expect(stepByKey(detail!.onboarding.steps, "COMPANY_PROFILE").status).toBe("COMPLETE");
    expect(stepByKey(detail!.onboarding.steps, "PAYMENT_DETAILS").status).toBe("COMPLETE");
    expect(stepByKey(detail!.onboarding.steps, "DOMAIN_SETUP").status).toBe("COMPLETE");

    // ... but none of the underlying marker values ever appear anywhere
    // in the serialized onboarding view.
    const serialized = JSON.stringify(detail!.onboarding);
    expect(serialized).not.toContain(MARKERS.legalName);
    expect(serialized).not.toContain(MARKERS.bankName);
    expect(serialized).not.toContain(MARKERS.accountHolder);
    expect(serialized).not.toContain(MARKERS.accountNumber);
    expect(serialized).not.toContain(MARKERS.swiftBic);
    expect(serialized).not.toContain(MARKERS.customDomain);
    // Also never the raw organization id, or any tenant-relative href.
    expect(serialized).not.toContain(org.id);
    expect(serialized).not.toContain("/settings/");
    expect(serialized).not.toContain("/clients");
  });
});
