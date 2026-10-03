import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Project Hub V1 — the new canonical `/projects/[id]` route: from-list
 * navigation, header/tabs, invalid-tab fallback, tenant isolation, every
 * tab rendering without error, and a narrow-viewport no-overflow check.
 * Per-section deep coverage (Tasks/Time/Invoices/Activity/Files
 * interaction paths) is already exhaustively covered by their own
 * existing dedicated specs (comments.spec.ts, settings-uploads-migration.
 * spec.ts, time-entries flows, invoices.spec.ts) — deliberately not
 * repeated here.
 */

let fixtures: TestFixtures;

async function actAs(
  context: BrowserContext,
  baseURL: string,
  identity: { id: string; email: string },
  organizationId: string,
): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, identity, baseURL);
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

test.describe("Project Hub", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test("Projects list: the Name link opens the Hub; the Edit link is unchanged", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/projects");

    const nameLink = page.getByRole("link", { name: fixtures.project.name });
    await expect(nameLink).toHaveAttribute("href", `/projects/${fixtures.project.id}`);
    await nameLink.click();
    await expect(page).toHaveURL(new RegExp(`/projects/${fixtures.project.id}$`));
    await expect(page.getByRole("link", { name: "Edit project" })).toHaveAttribute(
      "href",
      `/projects/${fixtures.project.id}/edit`,
    );
  });

  test("header shows client/status/owner; Overview is the default tab; every tab link is present", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto(`/projects/${fixtures.project.id}`);

    await expect(page.getByRole("heading", { name: fixtures.project.name })).toBeVisible();
    await expect(page.getByRole("link", { name: fixtures.clientA.name })).toHaveAttribute(
      "href",
      `/clients/${fixtures.clientA.id}`,
    );

    const nav = page.getByRole("navigation", { name: "Project sections" });
    for (const tab of ["Overview", "Tasks", "Time", "Invoices", "Contracts", "Activity", "Files"]) {
      await expect(nav.getByRole("link", { name: tab })).toBeVisible();
    }
    await expect(nav.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
  });

  test("an unknown ?tab= value falls back to Overview, never a blank or error page", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto(`/projects/${fixtures.project.id}?tab=not-a-real-tab`);
    await expect(page.getByRole("heading", { name: fixtures.project.name })).toBeVisible();
    await expect(page.getByText("Open tasks")).toBeVisible();
  });

  test("every tab renders without a server error", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    for (const tab of ["overview", "tasks", "time", "invoices", "contracts", "activity", "files"]) {
      await page.goto(`/projects/${fixtures.project.id}?tab=${tab}`);
      await expect(page.getByText("Page not found")).toHaveCount(0);
      await expect(page.getByRole("heading", { name: fixtures.project.name })).toBeVisible();
    }
  });

  // Documents Slice A.
  test.describe("Contracts tab", () => {
    test.afterEach(async () => {
      await dbQuery("contract", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
    });

    test("empty state links back to Contracts; a Project-scoped Contract appears and its link opens the correct detail page", async ({
      context,
      baseURL,
      page,
    }) => {
      await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);

      await page.goto(`/projects/${fixtures.project.id}?tab=contracts`);
      await expect(page.getByText("No contracts yet")).toBeVisible();
      await expect(page.getByRole("link", { name: "Go to Contracts" })).toHaveAttribute("href", "/contracts");

      const contract = await dbQuery<{ id: string }>("contract", "create", {
        data: {
          organizationId: fixtures.orgA.id,
          clientId: fixtures.clientA.id,
          projectId: fixtures.project.id,
          createdByUserId: fixtures.owner.id,
          contractNumber: `PHUB-E2E-${fixtures.runId}`,
          title: "Project Hub Contract",
          body: "Body.",
        },
      });

      await page.goto(`/projects/${fixtures.project.id}?tab=contracts`);
      const link = page.getByRole("link", { name: `PHUB-E2E-${fixtures.runId}` });
      await expect(link).toHaveAttribute("href", `/contracts/${contract.id}`);
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/contracts/${contract.id}$`));
      await expect(page.getByText("Project Hub Contract")).toBeVisible();
    });
  });

  test("a foreign-org Project id renders the same Staff-scoped not-found boundary as every other route", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.orgBOwner, fixtures.orgB.id);
    await page.goto(`/projects/${fixtures.project.id}`);
    await expect(page.getByText("Page not found")).toBeVisible();
    await expect(page.getByText(fixtures.project.name)).toHaveCount(0);
  });

  // Production defect (direct-load audit): a malformed, non-UUID route
  // id — a mistyped URL, a stale bookmark, a display value pasted into
  // the address bar instead of a real id — must resolve through the
  // same clean not-found boundary as any other inaccessible Project, not
  // the generic dashboard error boundary a raw Prisma P2007 (invalid
  // input syntax for type uuid) would otherwise surface as. Uses
  // page.goto() — a genuine hard document navigation — matching exactly
  // how the Production symptom was observed and reproduced.
  for (const malformedId of ["123", "not-a-uuid"]) {
    test(`a malformed route id (${malformedId}) renders the clean not-found boundary, never the generic error boundary`, async ({
      context,
      baseURL,
      page,
    }) => {
      await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      await page.goto(`/projects/${malformedId}`);
      await expect(page.getByText("Page not found")).toBeVisible();
      await expect(page.getByText("Something went wrong")).toHaveCount(0);
    });
  }

  test("390px: header and tabs render with no horizontal overflow, on Overview, Tasks, and Contracts", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto(`/projects/${fixtures.project.id}`);
    await expect(page.getByRole("heading", { name: fixtures.project.name })).toBeVisible();
    let overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);

    await page.goto(`/projects/${fixtures.project.id}?tab=tasks`);
    overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);

    await page.goto(`/projects/${fixtures.project.id}?tab=contracts`);
    const nav = page.getByRole("navigation", { name: "Project sections" });
    await expect(nav.getByRole("link", { name: "Contracts" })).toBeVisible();
    overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);
  });
});
