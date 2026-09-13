import { randomUUID } from "node:crypto";
import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * CSV Import/Export Phase 1 — the "Export CSV" control on the Clients and
 * Leads list pages. Domain-layer correctness (filter parity, tenant
 * isolation, CSV serialization, formula-injection neutralization) is
 * already exhaustively covered by test/integration/clients/export.test.ts
 * and test/integration/leads/export.test.ts — deliberately not repeated
 * here. This file covers only what those Route-Handler-level tests
 * cannot: real rendered visibility by role, and no layout regression at
 * the three required breakpoints.
 */

let fixtures: TestFixtures;

async function actAs(context: BrowserContext, baseURL: string, user: { id: string; email: string }, organizationId: string): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, user, baseURL);
  await context.addCookies([
    {
      name: "active_organization_id",
      value: organizationId,
      domain: new URL(baseURL).hostname,
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

test.describe("Export CSV control", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test("OWNER sees Export CSV on Clients and Leads (both views); MEMBER never does", async ({ page, context, baseURL }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);

    await page.goto("/clients");
    await expect(page.getByRole("link", { name: "Export CSV" })).toBeVisible();

    await page.goto("/leads");
    await expect(page.getByRole("link", { name: "Export CSV" })).toBeVisible();

    await page.goto("/leads?view=list");
    await expect(page.getByRole("link", { name: "Export CSV" })).toBeVisible();

    await actAs(context, baseURL!, fixtures.member, fixtures.orgA.id);

    await page.goto("/clients");
    await expect(page.getByRole("link", { name: "Export CSV" })).toHaveCount(0);

    await page.goto("/leads");
    await expect(page.getByRole("link", { name: "Export CSV" })).toHaveCount(0);
  });

  test("ADMIN sees Export CSV too", async ({ page, context, baseURL }) => {
    await actAs(context, baseURL!, fixtures.admin, fixtures.orgA.id);
    await page.goto("/clients");
    await expect(page.getByRole("link", { name: "Export CSV" })).toBeVisible();
  });

  test("the Export CSV link's href reflects the active list filter and never a page number", async ({ page, context, baseURL }) => {
    const lead = await dbQuery<{ id: string; name: string }>("lead", "create", {
      data: { name: `CSV-Export-Href-${randomUUID().slice(0, 6)}`, organizationId: fixtures.orgA.id },
    });

    try {
      await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      await page.goto(`/leads?q=${encodeURIComponent("CSV-Export-Href")}&page=2`);

      const href = await page.getByRole("link", { name: "Export CSV" }).getAttribute("href");
      expect(href).toContain("/api/leads/export");
      expect(href).toContain(`q=${encodeURIComponent("CSV-Export-Href")}`);
      expect(href).not.toContain("page=");
    } finally {
      await dbQuery("lead", "delete", { where: { id: lead.id } });
    }
  });

  test("a downloaded Client export document begins with the UTF-8 BOM, then the bare sep=, Excel-compatibility directive, before the real header row", async ({
    context,
    baseURL,
  }) => {
    // Excel Compatibility Fix — production issue: Client export opened
    // directly in Excel under a comma-decimal regional setting (e.g.
    // Russian) rendered the whole header row in one column. This exercises
    // the real, authenticated route response (same session/cookies as the
    // browser context) exactly as a real download would receive it,
    // without needing OS-level Excel automation or a native browser
    // download-dialog handshake — the actual bytes are what matters here.
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);

    const response = await context.request.get(new URL("/api/clients/export", baseURL).toString());
    expect(response.ok()).toBe(true);
    const bytes = await response.body();

    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    const text = bytes.toString("utf8");
    const firstLine = text.replace(/^﻿/, "").split("\r\n")[0];
    expect(firstLine).toBe("sep=,");

    const secondLine = text.replace(/^﻿/, "").split("\r\n")[1];
    expect(secondLine.startsWith("ID,Name,Company")).toBe(true);
  });

  for (const { width, label } of [
    { width: 1280, label: "1280px (desktop)" },
    { width: 834, label: "834px (tablet)" },
    { width: 390, label: "390px (mobile)" },
  ]) {
    test(`at ${label}: Export CSV is reachable and existing filters/actions remain usable, no layout regression`, async ({
      page,
      context,
      baseURL,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);

      await page.goto("/clients");
      const exportLink = page.getByRole("link", { name: "Export CSV" });
      await expect(exportLink).toBeVisible();
      const exportBox = await exportLink.boundingBox();
      expect(exportBox).not.toBeNull();
      expect(exportBox!.x + exportBox!.width).toBeLessThanOrEqual(width);

      // The primary "Add client" action and the search filter bar must
      // remain visible/usable alongside the new control — no destructive
      // overflow, no control pushed off-screen or hidden by it.
      await expect(page.getByRole("link", { name: "Add client" })).toBeVisible();
      await expect(page.getByPlaceholder("Search by name, company, or email")).toBeVisible();

      await page.goto("/leads");
      await expect(page.getByRole("link", { name: "Export CSV" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Add lead" })).toBeVisible();
    });
  }
});
