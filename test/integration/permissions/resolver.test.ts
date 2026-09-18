import { randomUUID } from "node:crypto";
import { describe, expect, it, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { PERMISSION_KEYS } from "@/lib/permissions/catalog";
import { getEffectivePermission, getEffectivePermissionSet } from "@/lib/permissions/resolver";
import { testSlug } from "../../support/run-id";

/**
 * Roles / Permissions V1 — the central resolver (locked spec §8/§9/§23).
 * Read-only assertions against a fresh, never-seeded organizationId need
 * no real Organization row (a `findMany` that legitimately matches zero
 * rows works against any UUID) -- but RolePermissionOverride.organizationId
 * has a real FK to Organization, so every test that WRITES a row creates
 * a disposable Organization first and cleans it up in its own afterEach.
 */

const READ_OPS = new Set(["findFirst", "findMany", "findUnique", "findFirstOrThrow", "findUniqueOrThrow", "count"]);

/** Same structural-call-counting technique as test/integration/industry-presets/apply.test.ts's own countingProxy — no mocking, a real Proxy around the real Prisma client. */
function countingProxy<T extends object>(target: T, counts: { reads: number }): T {
  return new Proxy(target, {
    get(obj, prop) {
      const value = Reflect.get(obj, prop);
      if (typeof value !== "object" || value === null) return value;
      return new Proxy(value, {
        get(modelObj, method) {
          const fn = Reflect.get(modelObj, method);
          if (typeof fn !== "function") return fn;
          return (...args: unknown[]) => {
            if (READ_OPS.has(String(method))) counts.reads += 1;
            return fn.apply(modelObj, args);
          };
        },
      });
    },
  });
}

async function createDisposableOrg(): Promise<string> {
  const org = await prisma.organization.create({
    data: { name: "Permissions Resolver Test Org", slug: testSlug(`permissions-resolver-${randomUUID().slice(0, 8)}`) },
  });
  return org.id;
}

describe("getEffectivePermissionSet / getEffectivePermission -- zero overrides", () => {
  it("no override -> catalog default, for every key", async () => {
    const organizationId = randomUUID();
    const adminSet = await getEffectivePermissionSet({ organizationId, role: "ADMIN" });
    const memberSet = await getEffectivePermissionSet({ organizationId, role: "MEMBER" });
    for (const key of PERMISSION_KEYS) {
      expect(adminSet[key]).toBe(true);
      expect(memberSet[key]).toBe(false);
    }
  });

  it("OWNER is always true for every key, and never queries RolePermissionOverride at all", async () => {
    const organizationId = randomUUID();
    const counts = { reads: 0 };
    const countedClient = countingProxy(prisma, counts);

    const set = await getEffectivePermissionSet({ organizationId, role: "OWNER" }, countedClient);
    for (const key of PERMISSION_KEYS) {
      expect(set[key]).toBe(true);
    }
    expect(counts.reads).toBe(0);

    const single = await getEffectivePermission(
      { organizationId, role: "OWNER", permissionKey: "ANALYTICS_VIEW" },
      countedClient,
    );
    expect(single).toBe(true);
    expect(counts.reads).toBe(0);
  });

  it("an unrecognized permissionKey fails closed without reaching the database", async () => {
    const organizationId = randomUUID();
    const counts = { reads: 0 };
    const countedClient = countingProxy(prisma, counts);

    // @ts-expect-error -- deliberately an invalid key, proving the runtime guard, not just the type system.
    const result = await getEffectivePermission({ organizationId, role: "ADMIN", permissionKey: "NOT_A_REAL_KEY" }, countedClient);
    expect(result).toBe(false);
    expect(counts.reads).toBe(0);
  });

  it("getEffectivePermissionSet issues exactly one query, regardless of catalog size (no N+1 per key)", async () => {
    const organizationId = randomUUID();
    const counts = { reads: 0 };
    const countedClient = countingProxy(prisma, counts);

    await getEffectivePermissionSet({ organizationId, role: "MEMBER" }, countedClient);
    expect(counts.reads).toBe(1);
  });

  it("getEffectivePermission (single key) also issues exactly one query, the same batched shape as getEffectivePermissionSet", async () => {
    const organizationId = randomUUID();
    const counts = { reads: 0 };
    const countedClient = countingProxy(prisma, counts);

    await getEffectivePermission({ organizationId, role: "ADMIN", permissionKey: "TAGS_MANAGE" }, countedClient);
    expect(counts.reads).toBe(1);
  });
});

describe("getEffectivePermissionSet / getEffectivePermission -- with overrides", () => {
  const cleanupOrgIds: string[] = [];

  afterEach(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: cleanupOrgIds } } });
    cleanupOrgIds.length = 0;
  });

  it("a MEMBER override of true wins over the false default", async () => {
    const organizationId = await createDisposableOrg();
    cleanupOrgIds.push(organizationId);
    await prisma.rolePermissionOverride.create({
      data: { organizationId, role: "MEMBER", permissionKey: "INDUSTRY_PRESETS_APPLY", allowed: true },
    });

    expect(await getEffectivePermission({ organizationId, role: "MEMBER", permissionKey: "INDUSTRY_PRESETS_APPLY" })).toBe(
      true,
    );
    // Every other key is still untouched, still its own default.
    expect(await getEffectivePermission({ organizationId, role: "MEMBER", permissionKey: "TAGS_MANAGE" })).toBe(false);
  });

  it("an ADMIN override of false wins over the true default", async () => {
    const organizationId = await createDisposableOrg();
    cleanupOrgIds.push(organizationId);
    await prisma.rolePermissionOverride.create({
      data: { organizationId, role: "ADMIN", permissionKey: "ANALYTICS_VIEW", allowed: false },
    });

    expect(await getEffectivePermission({ organizationId, role: "ADMIN", permissionKey: "ANALYTICS_VIEW" })).toBe(false);
    expect(await getEffectivePermission({ organizationId, role: "ADMIN", permissionKey: "REPORTS_VIEW" })).toBe(true);
  });

  it("OWNER ignores an override row entirely, even one for the same org+key targeting ADMIN, confirming OWNER never even looks", async () => {
    const organizationId = await createDisposableOrg();
    cleanupOrgIds.push(organizationId);
    await prisma.rolePermissionOverride.create({
      data: { organizationId, role: "ADMIN", permissionKey: "ANALYTICS_VIEW", allowed: false },
    });

    // Same org, same key, OWNER role -- unaffected by the ADMIN-targeted row above.
    expect(await getEffectivePermission({ organizationId, role: "OWNER", permissionKey: "ANALYTICS_VIEW" })).toBe(true);
  });

  it("tenant isolation: org A's override never affects org B", async () => {
    const orgA = await createDisposableOrg();
    const orgB = await createDisposableOrg();
    cleanupOrgIds.push(orgA, orgB);
    await prisma.rolePermissionOverride.create({
      data: { organizationId: orgA, role: "MEMBER", permissionKey: "DATA_EXPORT", allowed: true },
    });

    expect(await getEffectivePermission({ organizationId: orgA, role: "MEMBER", permissionKey: "DATA_EXPORT" })).toBe(true);
    expect(await getEffectivePermission({ organizationId: orgB, role: "MEMBER", permissionKey: "DATA_EXPORT" })).toBe(false);
  });

  it("a write is reflected on the very next read -- no caching layer between two independent resolver calls", async () => {
    const organizationId = await createDisposableOrg();
    cleanupOrgIds.push(organizationId);

    expect(await getEffectivePermission({ organizationId, role: "MEMBER", permissionKey: "WORKFLOW_AUTOMATIONS_MANAGE" })).toBe(
      false,
    );

    await prisma.rolePermissionOverride.create({
      data: { organizationId, role: "MEMBER", permissionKey: "WORKFLOW_AUTOMATIONS_MANAGE", allowed: true },
    });

    expect(await getEffectivePermission({ organizationId, role: "MEMBER", permissionKey: "WORKFLOW_AUTOMATIONS_MANAGE" })).toBe(
      true,
    );
  });

  it("getEffectivePermissionSet's batched result matches getEffectivePermission called individually for every key", async () => {
    const organizationId = await createDisposableOrg();
    cleanupOrgIds.push(organizationId);
    await prisma.rolePermissionOverride.createMany({
      data: [
        { organizationId, role: "MEMBER", permissionKey: "DATA_EXPORT", allowed: true },
        { organizationId, role: "MEMBER", permissionKey: "TAGS_MANAGE", allowed: true },
      ],
    });

    const set = await getEffectivePermissionSet({ organizationId, role: "MEMBER" });
    for (const key of PERMISSION_KEYS) {
      const individual = await getEffectivePermission({ organizationId, role: "MEMBER", permissionKey: key });
      expect(set[key]).toBe(individual);
    }
  });
});

describe("RolePermissionOverride -- OWNER row structurally impossible", () => {
  it("the database rejects an OWNER row via the migration's own CHECK constraint, independent of application code", async () => {
    const organizationId = await createDisposableOrg();
    try {
      await expect(
        prisma.rolePermissionOverride.create({
          data: { organizationId, role: "OWNER", permissionKey: "ANALYTICS_VIEW", allowed: true },
        }),
      ).rejects.toThrow();

      // Confirm nothing was actually persisted -- the rejected write left no row behind.
      const count = await prisma.rolePermissionOverride.count({ where: { organizationId } });
      expect(count).toBe(0);
    } finally {
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    }
  });
});
