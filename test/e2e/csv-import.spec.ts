import { randomUUID } from "node:crypto";
import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * CSV Import Phase 2 — the "Import CSV" wizard on the Clients and Leads
 * list pages. Domain-layer correctness (mapping validation, row
 * validation, duplicate handling, replay protection, Activity/Workflow
 * Automation suppression) is already exhaustively covered by
 * test/integration/import/{client,lead}-import.test.ts — deliberately
 * not repeated here. This file covers only what those Server-Action-
 * level tests cannot: the real rendered wizard, role-gated visibility,
 * and no layout regression at the three required breakpoints.
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

test.describe("Import CSV wizard", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test("OWNER sees Import CSV on Clients and Leads; MEMBER never does; direct navigation is blocked for MEMBER", async ({
    page,
    context,
    baseURL,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/clients");
    await expect(page.getByRole("link", { name: "Import CSV" })).toBeVisible();
    await page.goto("/leads");
    await expect(page.getByRole("link", { name: "Import CSV" })).toBeVisible();

    await actAs(context, baseURL!, fixtures.member, fixtures.orgA.id);
    await page.goto("/clients");
    await expect(page.getByRole("link", { name: "Import CSV" })).toHaveCount(0);

    // The (dashboard)-scoped not-found.tsx boundary renders here (see
    // dashboard-navigation-hardening.spec.ts's own identical precedent —
    // that spec deliberately asserts on rendered content for this exact
    // boundary too, never on the HTTP status code, since Next.js's own
    // handling of a nested notFound() call combined with this app's
    // shared dashboard layout doesn't reliably surface as a 404 status).
    await page.goto("/clients/import");
    await expect(page.getByText("Page not found")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Import Clients" })).toHaveCount(0);
  });

  test("ADMIN sees Import CSV too", async ({ page, context, baseURL }) => {
    await actAs(context, baseURL!, fixtures.admin, fixtures.orgA.id);
    await page.goto("/clients");
    await expect(page.getByRole("link", { name: "Import CSV" })).toBeVisible();
  });

  test("full wizard flow: upload -> map -> preview -> confirm -> summary, then back to Clients", async ({
    page,
    context,
    baseURL,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/clients/import");

    const suffix = randomUUID().slice(0, 8);
    const csv = `Name,Email,Company\r\nWizard-${suffix},wizard-${suffix}@example.com,Acme\r\n`;
    await page.setInputFiles('input[type="file"]', {
      name: "clients.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf-8"),
    });
    await page.getByRole("button", { name: "Continue" }).click();

    // Mapping step — the Name/Email/Company columns should already be
    // auto-suggested; just continue.
    await expect(page.getByText("Map columns")).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();

    // Preview step.
    await expect(page.getByText("Preview")).toBeVisible();
    await expect(page.getByText("Importable")).toBeVisible();
    await page.getByRole("button", { name: /Import 1 record/ }).click();

    // Summary step.
    await expect(page.getByText("Import complete")).toBeVisible();
    await expect(page.getByText("Imported")).toBeVisible();

    await page.getByRole("button", { name: "Back to Clients" }).click();
    await expect(page).toHaveURL(/\/clients$/);

    const created = await dbQuery<{ id: string }[]>("client", "findMany", {
      where: { organizationId: fixtures.orgA.id, name: `Wizard-${suffix}` },
    });
    expect(created).toHaveLength(1);
    await dbQuery("clientContact", "deleteMany", { where: { clientId: created[0].id } });
    await dbQuery("client", "delete", { where: { id: created[0].id } });
    await dbQuery("importJob", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
  });

  for (const { width, label } of [
    { width: 1280, label: "1280px (desktop)" },
    { width: 834, label: "834px (tablet)" },
    { width: 390, label: "390px (mobile)" },
  ]) {
    test(`at ${label}: Import CSV is reachable alongside Export CSV/Add, and the wizard itself has no destructive overflow`, async ({
      page,
      context,
      baseURL,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);

      await page.goto("/clients");
      const importLink = page.getByRole("link", { name: "Import CSV" });
      await expect(importLink).toBeVisible();
      const importBox = await importLink.boundingBox();
      expect(importBox).not.toBeNull();
      expect(importBox!.x + importBox!.width).toBeLessThanOrEqual(width);
      await expect(page.getByRole("link", { name: "Export CSV" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Add client" })).toBeVisible();

      const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      expect(overflowX).toBe(false);

      await page.goto("/clients/import");
      await expect(page.getByRole("heading", { name: "Import Clients" })).toBeVisible();
      const importPageOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(importPageOverflow).toBe(false);

      await page.goto("/leads");
      await expect(page.getByRole("link", { name: "Import CSV" })).toBeVisible();
    });
  }
});
