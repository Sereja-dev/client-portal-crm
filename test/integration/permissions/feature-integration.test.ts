import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/enums";
import { assertCanViewAnalytics, AnalyticsAccessError } from "@/lib/analytics/authorization";
import { assertCanViewReports, ReportsAccessError } from "@/lib/reports/authorization";
import { canImportData } from "@/lib/import/authorization";
import { canExportData } from "@/lib/export/authorization";
import { listRecurringInvoices } from "@/lib/recurring-invoices/recurring-invoices";
import { createTag } from "@/lib/tags/definitions";
import { listWorkflowAutomations } from "@/lib/workflow-automations/automations";
import { canManageQuoteTemplates } from "@/lib/quote-templates/authorization";
import { canApplyIndustryPreset } from "@/lib/industry-presets/authorization";
import { testSlug } from "../../support/run-id";

/**
 * Roles / Permissions V1 — feature integration coverage for all 9
 * catalog keys (locked spec §25). Each case proves the WIRING: granting
 * MEMBER via a real RolePermissionOverride row actually flips the real
 * domain function's decision, and denying ADMIN actually blocks it — not
 * a re-test of each feature's own unrelated business rules (already
 * covered by that feature's own test suite, and confirmed unaffected by
 * this refactor via the full existing suite passing unchanged). OWNER-
 * always-allowed and zero-override-preserves-current-behavior are
 * already proven generically by test/integration/permissions/resolver.test.ts
 * and by every existing pre-V1 test in this app continuing to pass
 * unchanged -- not re-proven per key here.
 */

async function createDisposableOrg(): Promise<string> {
  const org = await prisma.organization.create({
    data: { name: "Feature Integration Test Org", slug: testSlug(`permissions-feature-${randomUUID().slice(0, 8)}`) },
  });
  return org.id;
}

async function grant(organizationId: string, role: "ADMIN" | "MEMBER", permissionKey: string, allowed: boolean) {
  await prisma.rolePermissionOverride.create({ data: { organizationId, role, permissionKey, allowed } });
}

describe("Feature integration -- ANALYTICS_VIEW", () => {
  it("granting MEMBER permits the assert; denying ADMIN blocks it", async () => {
    const organizationId = await createDisposableOrg();
    try {
      await grant(organizationId, "MEMBER", "ANALYTICS_VIEW", true);
      await expect(assertCanViewAnalytics(organizationId, "MEMBER")).resolves.not.toThrow();

      await grant(organizationId, "ADMIN", "ANALYTICS_VIEW", false);
      await expect(assertCanViewAnalytics(organizationId, "ADMIN")).rejects.toThrow(AnalyticsAccessError);
    } finally {
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    }
  });
});

describe("Feature integration -- REPORTS_VIEW", () => {
  it("granting MEMBER permits the assert; denying ADMIN blocks it", async () => {
    const organizationId = await createDisposableOrg();
    try {
      await grant(organizationId, "MEMBER", "REPORTS_VIEW", true);
      await expect(assertCanViewReports(organizationId, "MEMBER")).resolves.not.toThrow();

      await grant(organizationId, "ADMIN", "REPORTS_VIEW", false);
      await expect(assertCanViewReports(organizationId, "ADMIN")).rejects.toThrow(ReportsAccessError);
    } finally {
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    }
  });
});

describe("Feature integration -- DATA_IMPORT", () => {
  it("granting MEMBER permits import; denying ADMIN blocks it", async () => {
    const organizationId = await createDisposableOrg();
    try {
      await grant(organizationId, "MEMBER", "DATA_IMPORT", true);
      expect(await canImportData(organizationId, "MEMBER")).toBe(true);

      await grant(organizationId, "ADMIN", "DATA_IMPORT", false);
      expect(await canImportData(organizationId, "ADMIN")).toBe(false);
    } finally {
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    }
  });
});

describe("Feature integration -- DATA_EXPORT", () => {
  it("granting MEMBER permits export; denying ADMIN blocks it", async () => {
    const organizationId = await createDisposableOrg();
    try {
      await grant(organizationId, "MEMBER", "DATA_EXPORT", true);
      expect(await canExportData(organizationId, "MEMBER")).toBe(true);

      await grant(organizationId, "ADMIN", "DATA_EXPORT", false);
      expect(await canExportData(organizationId, "ADMIN")).toBe(false);
    } finally {
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    }
  });
});

describe("Feature integration -- RECURRING_INVOICES_MANAGE", () => {
  it("granting MEMBER permits list (read); denying ADMIN blocks it -- the whole feature, not just writes", async () => {
    const organizationId = await createDisposableOrg();
    try {
      await grant(organizationId, "MEMBER", "RECURRING_INVOICES_MANAGE", true);
      const memberResult = await listRecurringInvoices(organizationId, { id: randomUUID(), name: "M", role: Role.MEMBER });
      expect(memberResult.ok).toBe(true);

      await grant(organizationId, "ADMIN", "RECURRING_INVOICES_MANAGE", false);
      const adminResult = await listRecurringInvoices(organizationId, { id: randomUUID(), name: "A", role: Role.ADMIN });
      expect(adminResult).toEqual({ ok: false, reason: "FORBIDDEN" });
    } finally {
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    }
  });
});

describe("Feature integration -- TAGS_MANAGE", () => {
  afterEach(async () => {
    // Nothing persistent to clean beyond the disposable org itself (Tag cascades with Organization).
  });

  it("management mutation: granting MEMBER permits create; denying ADMIN blocks it", async () => {
    const organizationId = await createDisposableOrg();
    try {
      await grant(organizationId, "MEMBER", "TAGS_MANAGE", true);
      const memberResult = await createTag(organizationId, { id: randomUUID(), name: "M", role: Role.MEMBER }, { name: "urgent" });
      expect(memberResult.ok).toBe(true);

      await grant(organizationId, "ADMIN", "TAGS_MANAGE", false);
      const adminResult = await createTag(organizationId, { id: randomUUID(), name: "A", role: Role.ADMIN }, { name: "other" });
      expect(adminResult).toEqual({ ok: false, reason: "FORBIDDEN" });
    } finally {
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    }
  });

  it("ordinary tag listing remains unaffected by this permission -- never gated, any role", async () => {
    const organizationId = await createDisposableOrg();
    try {
      await grant(organizationId, "MEMBER", "TAGS_MANAGE", false); // explicit deny, still irrelevant to listTags
      const { listTags } = await import("@/lib/tags/definitions");
      const tags = await listTags(organizationId);
      expect(tags).toEqual([]); // reachable at all (no FORBIDDEN thrown/returned) -- the actual point of this test
    } finally {
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    }
  });
});

describe("Feature integration -- WORKFLOW_AUTOMATIONS_MANAGE", () => {
  it("granting MEMBER permits list (read); denying ADMIN blocks it -- the whole feature, not just writes", async () => {
    const organizationId = await createDisposableOrg();
    try {
      await grant(organizationId, "MEMBER", "WORKFLOW_AUTOMATIONS_MANAGE", true);
      const memberResult = await listWorkflowAutomations(organizationId, { id: randomUUID(), name: "M", role: Role.MEMBER });
      expect(memberResult.ok).toBe(true);

      await grant(organizationId, "ADMIN", "WORKFLOW_AUTOMATIONS_MANAGE", false);
      const adminResult = await listWorkflowAutomations(organizationId, { id: randomUUID(), name: "A", role: Role.ADMIN });
      expect(adminResult).toEqual({ ok: false, reason: "FORBIDDEN" });
    } finally {
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    }
  });
});

describe("Feature integration -- QUOTE_TEMPLATES_MANAGE", () => {
  it("granting MEMBER permits management; denying ADMIN blocks it -- applying a template is untouched", async () => {
    const organizationId = await createDisposableOrg();
    try {
      await grant(organizationId, "MEMBER", "QUOTE_TEMPLATES_MANAGE", true);
      expect(await canManageQuoteTemplates(organizationId, "MEMBER")).toBe(true);

      await grant(organizationId, "ADMIN", "QUOTE_TEMPLATES_MANAGE", false);
      expect(await canManageQuoteTemplates(organizationId, "ADMIN")).toBe(false);

      // canApplyQuoteTemplates is sync, unconditional, and untouched by any override.
      const { canApplyQuoteTemplates } = await import("@/lib/quote-templates/authorization");
      expect(canApplyQuoteTemplates("MEMBER")).toBe(true);
      expect(canApplyQuoteTemplates("ADMIN")).toBe(true);
    } finally {
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    }
  });
});

describe("Feature integration -- INDUSTRY_PRESETS_APPLY", () => {
  it("granting MEMBER permits apply; denying ADMIN blocks it -- view/preview is untouched", async () => {
    const organizationId = await createDisposableOrg();
    try {
      await grant(organizationId, "MEMBER", "INDUSTRY_PRESETS_APPLY", true);
      expect(await canApplyIndustryPreset(organizationId, "MEMBER")).toBe(true);

      await grant(organizationId, "ADMIN", "INDUSTRY_PRESETS_APPLY", false);
      expect(await canApplyIndustryPreset(organizationId, "ADMIN")).toBe(false);

      // canViewIndustryPresets is sync, unconditional, and untouched by any override.
      const { canViewIndustryPresets } = await import("@/lib/industry-presets/authorization");
      expect(canViewIndustryPresets("MEMBER")).toBe(true);
      expect(canViewIndustryPresets("ADMIN")).toBe(true);
    } finally {
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    }
  });
});
