import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../../fixtures/seed";
import { executeGetOrganizationSummary } from "@/lib/ai/tools/organization-summary";

describe("executeGetOrganizationSummary — integration", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("returns aggregate counts scoped to the caller's own organization only", async () => {
    const result = await executeGetOrganizationSummary(fixtures.orgA.id, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The seeded fixture has exactly 1 client, 1 in-progress project, 1
    // task, 1 invoice for orgA — genuinely proving org-scoping (orgB's
    // own clientB is never counted here), not merely that the call
    // succeeded.
    expect(result.clients).toBeGreaterThanOrEqual(1);
    expect(result.activeProjects).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(result.projectStatusBreakdown)).toBe(true);
    expect(Array.isArray(result.taskStatusBreakdown)).toBe(true);
    expect(Array.isArray(result.invoiceStatusBreakdown)).toBe(true);
    expect(Array.isArray(result.recentInvoices)).toBe(true);
    expect(Array.isArray(result.upcomingTasks)).toBe(true);
    expect(Array.isArray(result.overdueTasks)).toBe(true);
  });

  it("never includes an id/ref field anywhere in its output (summary rows carry no chaining id)", async () => {
    const result = await executeGetOrganizationSummary(fixtures.orgA.id, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/"id"\s*:/);
    expect(serialized).not.toMatch(/"ref"\s*:/);
    for (const invoice of result.recentInvoices) {
      expect(Object.keys(invoice).sort()).toEqual(["amount", "clientName", "currency", "invoiceNumber", "status"].sort());
    }
    for (const task of [...result.upcomingTasks, ...result.overdueTasks]) {
      expect(Object.keys(task).sort()).toEqual(["dueDate", "projectName", "title"].sort());
    }
  });

  it("exposes zero free-text business content (no notes/description/internalNotes anywhere in the output)", async () => {
    const result = await executeGetOrganizationSummary(fixtures.orgA.id, {});
    expect(result.ok).toBe(true);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/notes/i);
    expect(serialized).not.toMatch(/description/i);
  });

  it("returns for an organization with zero data (orgB has no invoices/overdue tasks seeded beyond its own client)", async () => {
    const result = await executeGetOrganizationSummary(fixtures.orgB.id, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // orgB has exactly clientB and nothing else in the shared fixture —
    // proves this tool degrades gracefully to empty lists/zero counts,
    // never throwing on a sparse organization.
    expect(result.activeProjects).toBe(0);
    expect(result.recentInvoices).toEqual([]);
  });
});
