import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Contract Templates V1 — Settings → Contract templates UI. Real browser
 * coverage for the management surface: empty states, the create/edit/
 * duplicate/archive/restore happy path, the OWNER/ADMIN gate (MEMBER
 * nav-hidden + direct-URL denial, Portal redirect), and the responsive/
 * dark-theme gates — mirroring invoice-templates-settings.spec.ts's own
 * exact shape and scope discipline. Domain-layer correctness (validation
 * parity, tenant isolation, snapshot/zero-write guarantees) is already
 * exhaustively covered by test/integration/contract-templates/*.test.ts
 * and is not re-derived here — these tests only prove the UI wires into
 * that already-verified backend correctly and renders its results.
 */

let fixtures: TestFixtures;

async function actAsOwner(context: BrowserContext, baseURL: string): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, fixtures.owner, baseURL);
  await context.addCookies([
    {
      name: "active_organization_id",
      value: fixtures.orgA.id,
      domain: new URL(baseURL).hostname,
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

async function actAsMember(context: BrowserContext, baseURL: string): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, fixtures.member, baseURL);
  await context.addCookies([
    {
      name: "active_organization_id",
      value: fixtures.orgA.id,
      domain: new URL(baseURL).hostname,
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

test.describe("Contract Templates Settings UI (V1)", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await dbQuery("contractTemplate", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
    await cleanupTestData(fixtures);
  });

  test.beforeEach(async ({ context, baseURL }) => {
    await actAsOwner(context, baseURL!);
  });

  test.afterEach(async () => {
    await dbQuery("contractTemplate", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
  });

  test("empty state shows the create CTA; the archived tab has its own distinct empty state", async ({ page }) => {
    await page.goto("/settings/contract-templates");
    await expect(page.getByRole("heading", { name: "Contract templates" })).toBeVisible();
    await expect(page.getByText("No contract templates yet")).toBeVisible();
    await expect(page.getByRole("link", { name: "Create template" })).toBeVisible();

    await page.getByRole("group", { name: "Template status" }).getByRole("link", { name: "Archived" }).click();
    await expect(page).toHaveURL(/status=archived/);
    await expect(page.getByText("No archived templates")).toBeVisible();
    await expect(page.getByText("No contract templates yet")).toHaveCount(0);
  });

  test("create, edit, duplicate, archive, and restore a template end to end", async ({ page }) => {
    await page.goto("/settings/contract-templates/new");
    await page.getByLabel("Template name").fill("Web design retainer");
    await page.getByLabel("Contract title").fill("Web Design Retainer Agreement");
    await page.getByLabel("Contract body").fill("Scope of work: ongoing web design retainer services.");
    await page.getByLabel("Default expiry (days after issue)").fill("30");
    await page.getByLabel("Internal notes").fill("Always confirm scope before sending.");

    await page.getByRole("button", { name: "Create template" }).click();

    await expect(page).toHaveURL(/\/settings\/contract-templates$/);
    await expect(page.getByRole("status").filter({ hasText: "Template created" })).toBeVisible();

    const row = page.getByRole("row", { name: /Web design retainer/ });
    await expect(row).toBeVisible();
    await expect(row.getByText("30 days after issue")).toBeVisible();

    // Edit.
    await row.getByRole("link", { name: "Edit" }).click();
    await expect(page.getByRole("heading", { name: "Edit contract template" })).toBeVisible();
    await expect(page.getByLabel("Template name")).toHaveValue("Web design retainer");
    await expect(page.getByLabel("Contract body")).toHaveValue("Scope of work: ongoing web design retainer services.");
    await expect(page.getByLabel("Internal notes")).toHaveValue("Always confirm scope before sending.");
    await page.getByLabel("Template name").fill("Web design retainer (renamed)");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(/\/settings\/contract-templates$/);
    await expect(page.getByRole("status").filter({ hasText: "Template updated" })).toBeVisible();
    const renamedRow = page.getByRole("row", { name: /Web design retainer \(renamed\)/ });
    await expect(renamedRow).toBeVisible();

    // Duplicate — opens the new copy for review.
    await renamedRow.getByRole("button", { name: "Duplicate" }).click();
    await expect(page.getByRole("status").filter({ hasText: "duplicated" })).toBeVisible();
    await expect(page).toHaveURL(/\/settings\/contract-templates\/[0-9a-f-]{36}$/);
    await expect(page.getByLabel("Template name")).toHaveValue("Web design retainer (renamed) Copy");

    await page.goto("/settings/contract-templates");
    await expect(page.getByRole("row", { name: /Web design retainer \(renamed\) Copy/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /^Web design retainer \(renamed\)(?! Copy)/ })).toBeVisible();

    // Archive the original — confirms first, disappears from Active,
    // appears on Archived with no Edit or "Use template" link.
    const originalRow = page.getByRole("row", { name: /^Web design retainer \(renamed\)(?! Copy)/ });
    await originalRow.getByRole("button", { name: "Archive" }).click();
    await page.locator("dialog[open]").getByRole("button", { name: "Archive", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "archived" })).toBeVisible();
    await expect(page.getByRole("row", { name: /^Web design retainer \(renamed\)(?! Copy)/ })).toHaveCount(0);

    await page.getByRole("group", { name: "Template status" }).getByRole("link", { name: "Archived" }).click();
    const archivedRow = page.getByRole("row", { name: /^Web design retainer \(renamed\)(?! Copy)/ });
    await expect(archivedRow).toBeVisible();
    await expect(archivedRow.getByRole("link", { name: "Edit" })).toHaveCount(0);
    await expect(archivedRow.getByRole("link", { name: "Use template" })).toHaveCount(0);
    await expect(archivedRow.getByRole("button", { name: "Duplicate" })).toBeVisible();

    // Restore — back to Active, with "Use template" restored too.
    await archivedRow.getByRole("button", { name: "Restore" }).click();
    await expect(page.getByRole("status").filter({ hasText: "restored to active templates" })).toBeVisible();
    await page.getByRole("group", { name: "Template status" }).getByRole("link", { name: "Active" }).click();
    const restoredRow = page.getByRole("row", { name: /^Web design retainer \(renamed\)(?! Copy)/ });
    await expect(restoredRow).toBeVisible();
    await expect(restoredRow.getByRole("link", { name: "Use template" })).toBeVisible();
  });

  test("blank required fields are rejected inline without leaving the form", async ({ page }) => {
    await page.goto("/settings/contract-templates/new");
    await page.getByLabel("Template name").fill("  ");
    await page.getByLabel("Contract title").fill("Some Title");
    await page.getByLabel("Contract body").fill("Some body content.");
    await page.getByRole("button", { name: "Create template" }).click();
    await expect(page).toHaveURL(/\/settings\/contract-templates\/new$/);
    await expect(page.getByText("Template name is required.")).toBeVisible();
  });

  test("MEMBER does not see the Contract templates settings link and direct navigation fails closed", async ({ context, baseURL, page }) => {
    await actAsMember(context, baseURL!);
    await page.goto("/settings/company");
    await expect(page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Contract templates" })).toHaveCount(0);

    await page.goto("/settings/contract-templates");
    await expect(page.getByText("Not available")).toBeVisible();
    await expect(page.getByText("No contract templates yet")).toHaveCount(0);
  });

  test("a Portal identity is redirected away from /settings/contract-templates", async ({ context, baseURL, page }) => {
    await context.clearCookies();
    await injectTestSession(context, { id: fixtures.portalUser.id, email: fixtures.portalUser.email }, baseURL!);
    await page.goto("/settings/contract-templates");
    await expect(page).toHaveURL(/\/portal/);
  });

  test.describe("responsive", () => {
    test("390px: no page-level horizontal overflow, create form fits the viewport", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 900 });
      await page.goto("/settings/contract-templates");
      const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(hasOverflow).toBe(false);

      await page.goto("/settings/contract-templates/new");
      const overflowOnForm = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflowOnForm).toBe(false);
      await expect(page.getByLabel("Template name")).toBeVisible();
    });

    test("834px: status tabs and list remain usable, no overflow", async ({ page }) => {
      await page.setViewportSize({ width: 834, height: 1100 });
      await page.goto("/settings/contract-templates");
      const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(hasOverflow).toBe(false);
      await expect(page.getByRole("group", { name: "Template status" }).getByRole("link", { name: "Archived" })).toBeVisible();
    });

    test("1280px: the full desktop table is visible", async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await dbQuery("contractTemplate", "create", {
        data: {
          name: `Wide Template ${fixtures.runId}`,
          title: "Wide Template Title",
          body: "Body content",
          organizationId: fixtures.orgA.id,
          createdByUserId: fixtures.owner.id,
        },
      });
      await page.goto("/settings/contract-templates");
      await expect(page.getByRole("columnheader", { name: "Contract title" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Expiry" })).toBeVisible();
    });
  });

  test("dark theme: list and form are legible with no console errors", async ({ page, context, baseURL }) => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "DARK" } });
    await actAsOwner(context, baseURL!);

    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto("/settings/contract-templates");
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");
    await page.goto("/settings/contract-templates/new");
    await expect(page.getByLabel("Template name")).toBeVisible();

    expect(errors).toEqual([]);
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "SYSTEM" } });
  });
});
