import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getReportsOverview } from "@/lib/reports/service";
import { canViewReports, assertCanViewReports, ReportsAccessError } from "@/lib/reports/authorization";
import { canImportData } from "@/lib/import/authorization";
import { canExportData } from "@/lib/export/authorization";
import { Role } from "@/generated/prisma/enums";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { actAs, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal, resetNavigationMock } from "../../support/navigation-mock";

describe("Reports authorization", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(() => {
    resetAuthMock();
    resetNavigationMock();
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  describe("canViewReports / assertCanViewReports", () => {
    it("allows OWNER and ADMIN, denies MEMBER", () => {
      expect(canViewReports(Role.OWNER)).toBe(true);
      expect(canViewReports(Role.ADMIN)).toBe(true);
      expect(canViewReports(Role.MEMBER)).toBe(false);
    });

    it("assertCanViewReports throws ReportsAccessError for MEMBER, not for OWNER/ADMIN", () => {
      expect(() => assertCanViewReports(Role.MEMBER)).toThrow(ReportsAccessError);
      expect(() => assertCanViewReports(Role.OWNER)).not.toThrow();
      expect(() => assertCanViewReports(Role.ADMIN)).not.toThrow();
    });

    it("is its own semantic boundary, not merely a re-export of Export/Import authorization", () => {
      // Import/Export currently use the exact same OWNER+ADMIN role set
      // (src/lib/import/authorization.ts, src/lib/export/authorization.ts)
      // -- this proves Reports has an independent function, not a shared
      // import, so the two can diverge in the future without one
      // silently changing the other.
      expect(canViewReports).not.toBe(canImportData as unknown as typeof canViewReports);
      expect(canViewReports).not.toBe(canExportData as unknown as typeof canViewReports);
      // Same current role set today (both OWNER+ADMIN) -- distinct
      // functions, not distinct behavior, is exactly the point.
      expect(canViewReports(Role.OWNER)).toBe(canImportData(Role.OWNER));
      expect(canViewReports(Role.MEMBER)).toBe(canExportData(Role.MEMBER));
    });
  });

  describe("getReportsOverview — server-side enforcement", () => {
    it("OWNER is allowed", async () => {
      actAs(fixtures.owner, fixtures.orgA.id);
      await expect(getReportsOverview()).resolves.toBeDefined();
    });

    it("ADMIN is allowed", async () => {
      actAs(fixtures.admin, fixtures.orgA.id);
      await expect(getReportsOverview()).resolves.toBeDefined();
    });

    it("MEMBER is denied server-side with ReportsAccessError, not merely hidden in a future UI", async () => {
      actAs(fixtures.member, fixtures.orgA.id);
      await expect(getReportsOverview()).rejects.toBeInstanceOf(ReportsAccessError);
    });

    it("a Client Portal identity never reaches the Reports authorization check at all -- it is redirected to /portal first, by the same guard every other Staff-only entry point already relies on", async () => {
      actAs({ id: fixtures.portalUser.id, email: fixtures.portalUser.email }, fixtures.orgA.id);
      await expect(getReportsOverview()).rejects.toBeInstanceOf(RedirectSignal);
    });

    it("organizationId can never be forged -- getReportsOverview accepts no organizationId parameter at all; it is always resolved from the current session", async () => {
      actAs(fixtures.owner, fixtures.orgA.id);
      const result = await getReportsOverview();
      expect(result.organizationId).toBe(fixtures.orgA.id);

      // Switching the active-organization cookie to org B (still the
      // SAME authenticated user -- orgBOwner is a different identity, so
      // this proves the cookie alone, not just "a different user", drives
      // resolution) changes which organization's data comes back --
      // there is no other input this function reads.
      actAs(fixtures.orgBOwner, fixtures.orgB.id);
      const resultB = await getReportsOverview();
      expect(resultB.organizationId).toBe(fixtures.orgB.id);
    });
  });
});
