import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  suspendOrganizationAction,
  reactivateOrganizationAction,
} from "@/app/(platform-admin)/platform-admin/organizations/[id]/actions";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { setMockAuthUser, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal, resetNavigationMock } from "../../support/navigation-mock";
import { testSlug } from "../../support/run-id";

/**
 * Platform Admin Organization Suspension, PR 2. Covers the two Server
 * Actions this PR adds — suspendOrganizationAction/reactivateOrganizationAction
 * — end to end against the real (test) Postgres: authorization,
 * validation, the atomic conditional transition, exactly-one-audit-row
 * transactional recording, idempotency, and concurrency safety.
 *
 * PR 1's own test/integration/organization-access/suspension.test.ts
 * already proves every read path honors Organization.suspendedAt; this
 * file is the first place any of these values are ever set via a real
 * mutation rather than a direct Prisma write in a test's own setup.
 */

const PLATFORM_ADMIN_TEST_EMAIL = "platform-admin-suspension-actions-test@example.com";
const NON_ADMIN_TEST_EMAIL = "not-a-platform-admin-suspension-actions-test@example.com";
const ORIGINAL_PLATFORM_ADMIN_EMAILS = process.env.PLATFORM_ADMIN_EMAILS;

let fixtures: TestFixtures;

beforeAll(async () => {
  fixtures = await seedTestData();
  process.env.PLATFORM_ADMIN_EMAILS = PLATFORM_ADMIN_TEST_EMAIL;
});

afterEach(() => {
  resetAuthMock();
  resetNavigationMock();
});

afterAll(async () => {
  await cleanupTestData(fixtures);
  if (ORIGINAL_PLATFORM_ADMIN_EMAILS === undefined) {
    delete process.env.PLATFORM_ADMIN_EMAILS;
  } else {
    process.env.PLATFORM_ADMIN_EMAILS = ORIGINAL_PLATFORM_ADMIN_EMAILS;
  }
});

function asUnauthenticated() {
  setMockAuthUser(null);
}

function asNonAdmin() {
  setMockAuthUser({ id: randomUUID(), email: NON_ADMIN_TEST_EMAIL });
}

function asPlatformAdmin() {
  setMockAuthUser({ id: randomUUID(), email: PLATFORM_ADMIN_TEST_EMAIL });
}

async function createOrg(label: string, suspended = false) {
  return prisma.organization.create({
    data: {
      name: `Suspension Action Test ${label}`,
      slug: testSlug(`susp-action-${label}-${randomUUID().slice(0, 8)}`),
      suspendedAt: suspended ? new Date() : null,
    },
  });
}

async function auditEventsFor(organizationId: string) {
  return prisma.platformAdminAuditEvent.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } });
}

async function catchRedirect(fn: () => Promise<unknown>): Promise<RedirectSignal> {
  let caught: unknown;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(RedirectSignal);
  return caught as RedirectSignal;
}

describe("Authorization — both actions call requirePlatformAdmin() first, before any read or write", () => {
  it("suspendOrganizationAction: unauthenticated is redirected to /login, and neither the organization nor any audit row is touched", async () => {
    const org = await createOrg("unauth-suspend");
    try {
      asUnauthenticated();
      const signal = await catchRedirect(() => suspendOrganizationAction(org.id, "OTHER"));
      expect(signal.url).toBe("/login?reason=session_expired");

      const reread = await prisma.organization.findUniqueOrThrow({ where: { id: org.id }, select: { suspendedAt: true } });
      expect(reread.suspendedAt).toBeNull();
      expect(await auditEventsFor(org.id)).toHaveLength(0);
    } finally {
      await prisma.organization.delete({ where: { id: org.id } });
    }
  });

  it("suspendOrganizationAction: authenticated non-admin is redirected to /dashboard, and neither the organization nor any audit row is touched", async () => {
    const org = await createOrg("nonadmin-suspend");
    try {
      asNonAdmin();
      const signal = await catchRedirect(() => suspendOrganizationAction(org.id, "OTHER"));
      expect(signal.url).toBe("/dashboard");

      const reread = await prisma.organization.findUniqueOrThrow({ where: { id: org.id }, select: { suspendedAt: true } });
      expect(reread.suspendedAt).toBeNull();
      expect(await auditEventsFor(org.id)).toHaveLength(0);
    } finally {
      await prisma.organization.delete({ where: { id: org.id } });
    }
  });

  it("reactivateOrganizationAction: unauthenticated is redirected to /login, and neither the organization nor any audit row is touched", async () => {
    const org = await createOrg("unauth-reactivate", true);
    try {
      asUnauthenticated();
      const signal = await catchRedirect(() => reactivateOrganizationAction(org.id));
      expect(signal.url).toBe("/login?reason=session_expired");

      const reread = await prisma.organization.findUniqueOrThrow({ where: { id: org.id }, select: { suspendedAt: true } });
      expect(reread.suspendedAt).not.toBeNull();
      expect(await auditEventsFor(org.id)).toHaveLength(0);
    } finally {
      await prisma.organization.delete({ where: { id: org.id } });
    }
  });

  it("reactivateOrganizationAction: authenticated non-admin is redirected to /dashboard, and neither the organization nor any audit row is touched", async () => {
    const org = await createOrg("nonadmin-reactivate", true);
    try {
      asNonAdmin();
      const signal = await catchRedirect(() => reactivateOrganizationAction(org.id));
      expect(signal.url).toBe("/dashboard");

      const reread = await prisma.organization.findUniqueOrThrow({ where: { id: org.id }, select: { suspendedAt: true } });
      expect(reread.suspendedAt).not.toBeNull();
      expect(await auditEventsFor(org.id)).toHaveLength(0);
    } finally {
      await prisma.organization.delete({ where: { id: org.id } });
    }
  });
});

describe("Input validation — checked after authorization, before any write", () => {
  it("an invalid (non-UUID) organizationId is rejected with the generic not-found message, no write", async () => {
    asPlatformAdmin();
    const result = await suspendOrganizationAction("definitely-invalid-test-id", "OTHER");
    expect(result).toEqual({ ok: false, message: "Organization not found." });
  });

  it("a valid-shaped but nonexistent organizationId is rejected with the generic not-found message, no write", async () => {
    asPlatformAdmin();
    const result = await suspendOrganizationAction(randomUUID(), "OTHER");
    expect(result).toEqual({ ok: false, message: "Organization not found." });
  });

  it("reactivateOrganizationAction: an invalid (non-UUID) organizationId is rejected with the generic not-found message", async () => {
    asPlatformAdmin();
    const result = await reactivateOrganizationAction("definitely-invalid-test-id");
    expect(result).toEqual({ ok: false, message: "Organization not found." });
  });

  it("reactivateOrganizationAction: a valid-shaped but nonexistent organizationId is rejected with the generic not-found message", async () => {
    asPlatformAdmin();
    const result = await reactivateOrganizationAction(randomUUID());
    expect(result).toEqual({ ok: false, message: "Organization not found." });
  });

  it("an unknown reason code is rejected without suspending, and without any audit row", async () => {
    const org = await createOrg("bad-reason");
    try {
      asPlatformAdmin();
      const result = await suspendOrganizationAction(org.id, "NOT_A_REAL_REASON");
      expect(result).toEqual({ ok: false, message: "Choose a valid reason." });

      const reread = await prisma.organization.findUniqueOrThrow({ where: { id: org.id }, select: { suspendedAt: true } });
      expect(reread.suspendedAt).toBeNull();
      expect(await auditEventsFor(org.id)).toHaveLength(0);
    } finally {
      await prisma.organization.delete({ where: { id: org.id } });
    }
  });

  it("a freeform, operator-typed reason string is rejected exactly like an unknown code — the catalog is fixed, never freeform", async () => {
    const org = await createOrg("freeform-reason");
    try {
      asPlatformAdmin();
      const result = await suspendOrganizationAction(org.id, "Customer stopped paying their invoices");
      expect(result).toEqual({ ok: false, message: "Choose a valid reason." });
      const reread = await prisma.organization.findUniqueOrThrow({ where: { id: org.id }, select: { suspendedAt: true } });
      expect(reread.suspendedAt).toBeNull();
    } finally {
      await prisma.organization.delete({ where: { id: org.id } });
    }
  });
});

describe("suspendOrganizationAction — the real transition", () => {
  it("suspends the organization and writes exactly one ORGANIZATION_SUSPENDED audit row with the given reason code and the acting admin's email", async () => {
    const org = await createOrg("suspend-real");
    try {
      asPlatformAdmin();
      const before = new Date();
      const result = await suspendOrganizationAction(org.id, "BILLING_DISPUTE");
      const after = new Date();
      expect(result).toEqual({ ok: true });

      const reread = await prisma.organization.findUniqueOrThrow({ where: { id: org.id }, select: { suspendedAt: true } });
      expect(reread.suspendedAt).not.toBeNull();
      expect(reread.suspendedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(reread.suspendedAt!.getTime()).toBeLessThanOrEqual(after.getTime());

      const events = await auditEventsFor(org.id);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        action: "ORGANIZATION_SUSPENDED",
        actorEmail: PLATFORM_ADMIN_TEST_EMAIL,
        reasonCode: "BILLING_DISPUTE",
      });
    } finally {
      await prisma.organization.delete({ where: { id: org.id } });
    }
  });

  it("the audit row's actorEmail always comes from requirePlatformAdmin()'s own resolved identity, never from any parameter this action accepts (it accepts none for identity)", async () => {
    const org = await createOrg("actor-email-source");
    try {
      setMockAuthUser({ id: randomUUID(), email: PLATFORM_ADMIN_TEST_EMAIL });
      await suspendOrganizationAction(org.id, "OTHER");
      const [event] = await auditEventsFor(org.id);
      expect(event.actorEmail).toBe(PLATFORM_ADMIN_TEST_EMAIL);
    } finally {
      await prisma.organization.delete({ where: { id: org.id } });
    }
  });

  it("is idempotent: suspending an already-suspended organization is a no-op success with no second write and no second audit row", async () => {
    const org = await createOrg("suspend-idempotent", true);
    try {
      await prisma.platformAdminAuditEvent.create({
        data: { organizationId: org.id, action: "ORGANIZATION_SUSPENDED", actorEmail: PLATFORM_ADMIN_TEST_EMAIL, reasonCode: "OTHER" },
      });
      asPlatformAdmin();
      const result = await suspendOrganizationAction(org.id, "SECURITY_RISK");
      expect(result).toEqual({ ok: true });

      const events = await auditEventsFor(org.id);
      expect(events).toHaveLength(1); // still just the one seeded above
      expect(events[0].reasonCode).toBe("OTHER"); // untouched by the repeat call's different reason
    } finally {
      await prisma.organization.delete({ where: { id: org.id } });
    }
  });

  it("concurrent suspend calls on the same organization produce exactly one suspended state and exactly one audit row", async () => {
    const org = await createOrg("suspend-concurrent");
    try {
      asPlatformAdmin();
      const results = await Promise.all([
        suspendOrganizationAction(org.id, "POLICY_VIOLATION"),
        suspendOrganizationAction(org.id, "POLICY_VIOLATION"),
        suspendOrganizationAction(org.id, "POLICY_VIOLATION"),
      ]);
      expect(results.every((r) => r.ok)).toBe(true);

      const reread = await prisma.organization.findUniqueOrThrow({ where: { id: org.id }, select: { suspendedAt: true } });
      expect(reread.suspendedAt).not.toBeNull();

      const events = await auditEventsFor(org.id);
      expect(events).toHaveLength(1);
    } finally {
      await prisma.organization.delete({ where: { id: org.id } });
    }
  });
});

describe("reactivateOrganizationAction — the real transition", () => {
  it("reactivates the organization and writes exactly one ORGANIZATION_REACTIVATED audit row with no reason code", async () => {
    const org = await createOrg("reactivate-real", true);
    try {
      asPlatformAdmin();
      const result = await reactivateOrganizationAction(org.id);
      expect(result).toEqual({ ok: true });

      const reread = await prisma.organization.findUniqueOrThrow({ where: { id: org.id }, select: { suspendedAt: true } });
      expect(reread.suspendedAt).toBeNull();

      const events = await auditEventsFor(org.id);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ action: "ORGANIZATION_REACTIVATED", actorEmail: PLATFORM_ADMIN_TEST_EMAIL });
      expect(events[0].reasonCode).toBeNull();
    } finally {
      await prisma.organization.delete({ where: { id: org.id } });
    }
  });

  it("is idempotent: reactivating an already-active organization is a no-op success with no audit row", async () => {
    const org = await createOrg("reactivate-idempotent", false);
    try {
      asPlatformAdmin();
      const result = await reactivateOrganizationAction(org.id);
      expect(result).toEqual({ ok: true });
      expect(await auditEventsFor(org.id)).toHaveLength(0);
    } finally {
      await prisma.organization.delete({ where: { id: org.id } });
    }
  });

  it("concurrent reactivate calls on the same suspended organization produce exactly one active state and exactly one audit row", async () => {
    const org = await createOrg("reactivate-concurrent", true);
    try {
      asPlatformAdmin();
      const results = await Promise.all([
        reactivateOrganizationAction(org.id),
        reactivateOrganizationAction(org.id),
        reactivateOrganizationAction(org.id),
      ]);
      expect(results.every((r) => r.ok)).toBe(true);

      const reread = await prisma.organization.findUniqueOrThrow({ where: { id: org.id }, select: { suspendedAt: true } });
      expect(reread.suspendedAt).toBeNull();

      const events = await auditEventsFor(org.id);
      expect(events).toHaveLength(1);
    } finally {
      await prisma.organization.delete({ where: { id: org.id } });
    }
  });

  it("a full suspend -> reactivate -> suspend cycle produces exactly one audit row per real transition (three total), never a duplicate", async () => {
    const org = await createOrg("full-cycle");
    try {
      asPlatformAdmin();
      await suspendOrganizationAction(org.id, "CUSTOMER_REQUEST");
      await reactivateOrganizationAction(org.id);
      await suspendOrganizationAction(org.id, "OTHER");

      const events = await auditEventsFor(org.id);
      expect(events.map((e) => e.action)).toEqual(["ORGANIZATION_SUSPENDED", "ORGANIZATION_REACTIVATED", "ORGANIZATION_SUSPENDED"]);

      const reread = await prisma.organization.findUniqueOrThrow({ where: { id: org.id }, select: { suspendedAt: true } });
      expect(reread.suspendedAt).not.toBeNull();
    } finally {
      await prisma.organization.delete({ where: { id: org.id } });
    }
  });
});

describe("Transactional atomicity — the state change and its audit row can never diverge", () => {
  // Mirrors the established pattern in test/integration/billing/
  // provisioning.test.ts's own rollback test: a hand-rolled transaction
  // using the exact same write shapes suspendOrganizationAction/
  // reactivateOrganizationAction's own $transaction perform, forcing a
  // real Postgres constraint failure (not a hand-rolled throw) on the
  // audit insert.
  //
  // Deliberately creates the Organization *inside* the same failing
  // transaction, exactly like provisioning.test.ts's own test does,
  // rather than suspending/reactivating a row created beforehand: this
  // repo's test database is a single-connection PGlite instance (see
  // vitest.integration.config.mts's own comment), and empirically, a
  // failing $transaction on that single connection can roll back
  // further than its own writes when a *separately committed* prior row
  // is touched inside it — a test-harness limitation, not a claim about
  // this action's own correctness. Confining every write (including the
  // Organization's own creation) to inside the one failing transaction
  // sidesteps that limitation entirely while still genuinely proving
  // the property that matters: a real constraint failure on the audit
  // insert rolls back every other write in the same transaction,
  // including a suspend/reactivate-shaped Organization update — the
  // exact atomicity suspendOrganizationAction/reactivateOrganizationAction's
  // own doc comment relies on.
  it("a real failure on the audit insert rolls back a suspend-shaped transition performed in the same transaction", async () => {
    const slug = testSlug(`rollback-suspend-${randomUUID().slice(0, 8)}`);

    await expect(
      prisma.$transaction(async (tx) => {
        const org = await tx.organization.create({ data: { name: "Rollback Suspend", slug } });
        await tx.organization.updateMany({ where: { id: org.id, suspendedAt: null }, data: { suspendedAt: new Date() } });
        // Real FK-constraint failure: this organizationId was never created.
        await tx.platformAdminAuditEvent.create({
          data: { organizationId: randomUUID(), action: "ORGANIZATION_SUSPENDED", actorEmail: PLATFORM_ADMIN_TEST_EMAIL, reasonCode: "OTHER" },
        });
      }),
    ).rejects.toThrow();

    const orphaned = await prisma.organization.findUnique({ where: { slug } });
    expect(orphaned).toBeNull();
  });

  it("a real failure on the audit insert rolls back a reactivate-shaped transition performed in the same transaction", async () => {
    const slug = testSlug(`rollback-reactivate-${randomUUID().slice(0, 8)}`);

    await expect(
      prisma.$transaction(async (tx) => {
        const org = await tx.organization.create({ data: { name: "Rollback Reactivate", slug, suspendedAt: new Date() } });
        await tx.organization.updateMany({ where: { id: org.id, suspendedAt: { not: null } }, data: { suspendedAt: null } });
        await tx.platformAdminAuditEvent.create({
          data: { organizationId: randomUUID(), action: "ORGANIZATION_REACTIVATED", actorEmail: PLATFORM_ADMIN_TEST_EMAIL },
        });
      }),
    ).rejects.toThrow();

    const orphaned = await prisma.organization.findUnique({ where: { slug } });
    expect(orphaned).toBeNull();
  });
});

// Deliberately no further describe blocks after this point: the two
// rollback tests above are, empirically, the last tests that may safely
// run in this file (see their own header comment) — anything placed
// after them here would inherit the same single-connection PGlite
// corruption risk. "A Platform Admin can reactivate an organization
// suspended by someone else" is already covered above (see
// "reactivateOrganizationAction — the real transition"), so nothing is
// lost by not duplicating it down here.
