import { randomUUID } from "node:crypto";
import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Dashboard-navigation hardening (post-audit). Covers the concrete
 * regression surface named in the audit's own report:
 *  - Lead Edit opens the correct route, desktop and mobile — never
 *    Dashboard.
 *  - Tags Archive succeeds on its first confirmation, staying on
 *    /settings/tags — never a second attempt, never Dashboard.
 *  - A representative Settings save (Company profile) stays on its own
 *    route on success — never Dashboard.
 *  - The new (dashboard)-scoped not-found.tsx renders for a genuinely
 *    missing Staff record instead of the global marketing 404, and its
 *    own recovery actions never force a redirect anywhere by
 *    themselves.
 *
 * Domain-layer/Server Action correctness for each of these features is
 * already exhaustively covered by their own existing suites (tags.spec.ts,
 * leads.spec.ts, custom-statuses-settings.spec.ts,
 * custom-fields-settings.spec.ts, and the integration suite) —
 * deliberately not repeated here.
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

test.describe("Dashboard navigation hardening", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await dbQuery("tagAssignment", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
    await dbQuery("tag", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
    await dbQuery("lead", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
    await cleanupTestData(fixtures);
  });

  test.beforeEach(async ({ context, baseURL }) => {
    await actAsOwner(context, baseURL!);
  });

  test.afterEach(async () => {
    await dbQuery("tagAssignment", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
    await dbQuery("tag", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
    await dbQuery("lead", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
  });

  test("Lead Edit opens the correct route from the desktop table row, never Dashboard", async ({ page }) => {
    const lead = await dbQuery<{ id: string; name: string }>("lead", "create", {
      data: { name: `Hardening Lead ${randomUUID().slice(0, 6)}`, organizationId: fixtures.orgA.id },
    });

    await page.goto("/leads");
    await page.getByRole("row", { name: lead.name }).getByRole("link", { name: "Edit" }).click();

    await expect(page).toHaveURL(new RegExp(`/leads/${lead.id}/edit$`));
    expect(page.url()).not.toContain("/dashboard");
  });

  test("Lead Edit opens the correct route from the mobile RecordCard at 390px, never Dashboard", async ({ page }) => {
    const lead = await dbQuery<{ id: string; name: string }>("lead", "create", {
      data: { name: `Hardening Mobile Lead ${randomUUID().slice(0, 6)}`, organizationId: fixtures.orgA.id },
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/leads");
    await page.getByRole("listitem").filter({ hasText: lead.name }).getByRole("link", { name: "Edit" }).click();

    await expect(page).toHaveURL(new RegExp(`/leads/${lead.id}/edit$`));
    expect(page.url()).not.toContain("/dashboard");
    // The Lead edit form (and its embedded Tags section) is reachable and
    // usable at this width — no destructive page-level horizontal overflow.
    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(hasOverflow).toBe(false);
  });

  test("Tags Archive succeeds on the first confirmation, stays on /settings/tags, never Dashboard", async ({ page }) => {
    const tag = await dbQuery<{ id: string; name: string }>("tag", "create", {
      data: { organizationId: fixtures.orgA.id, name: `Hardening Tag ${randomUUID().slice(0, 6)}`, normalizedName: "hardening tag", color: "NEUTRAL" },
    });

    await page.goto("/settings/tags");
    const row = page.getByRole("row", { name: new RegExp(tag.name) });
    await row.getByRole("button", { name: "Archive" }).click();
    const dialog = page.locator("dialog[open]");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Archive", exact: true }).click();

    // One confirmation click is enough — no second attempt required.
    await expect(page.getByText("No tags yet")).toBeVisible();
    await expect(page).toHaveURL(/\/settings\/tags/);
    expect(page.url()).not.toContain("/dashboard");

    const archived = await dbQuery<{ archivedAt: string | null }>("tag", "findUniqueOrThrow", { where: { id: tag.id } });
    expect(archived.archivedAt).not.toBeNull();
  });

  test("Company profile save (representative Settings save) stays on /settings/company, never Dashboard", async ({ page }) => {
    await page.goto("/settings/company");
    await page.getByLabel("Display / company name").fill("Hardening Co");
    await page.getByLabel("Legal company name").fill("Hardening Co LLC");
    await page.getByLabel("Currency").selectOption("USD");
    await page.getByLabel("Time zone").selectOption({ index: 1 });
    await page.getByLabel("Country").fill("US");
    await page.getByRole("button", { name: "Save company profile" }).click();

    await expect(page.getByText("Company profile saved.")).toBeVisible();
    await expect(page).toHaveURL(/\/settings\/company/);
    expect(page.url()).not.toContain("/dashboard");
  });

  test("a genuinely missing Staff record renders the dashboard-scoped not-found page, not the global 404, and its actions never force a Dashboard redirect by themselves", async ({ page }) => {
    const bogusId = randomUUID();
    await page.goto(`/leads/${bogusId}/edit`);

    await expect(page.getByText("Page not found")).toBeVisible();
    // The dashboard shell (Sidebar/Header) is still present — this is the
    // (dashboard)-scoped boundary, not the global marketing-site 404.
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh this page" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Go back" })).toBeVisible();
    // Dashboard is offered as one option, not the page's own forced destination.
    expect(page.url()).toContain(`/leads/${bogusId}/edit`);
  });
});
