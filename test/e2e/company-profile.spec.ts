import { test, expect } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Company Profile Timezone Persistence Diagnostic — real-browser
 * reproduction of the Production observation (Settings -> Company
 * Profile: Asia/Singapore -> select Asia/Bangkok -> save -> UI returns
 * to Asia/Singapore). The read-only audit and a targeted integration
 * test (test/integration/organization-setup/company-profile.test.ts)
 * already proved the backend write/read path (updateCompanyProfileAction
 * -> upsertCompanyProfile -> getCompanyProfile) is structurally correct
 * and does persist a changed timezone. This file exists to determine,
 * through the REAL /settings/company page (not a synthetic harness),
 * whether the observed defect is instead in Client Component
 * refresh/remount behavior around the uncontrolled `<select
 * defaultValue>` timezone field.
 */

const COMPANY_PROFILE_PATH = "/settings/company";

async function seedSingaporeProfile(organizationId: string): Promise<void> {
  await dbQuery("organizationProfile", "deleteMany", { where: { organizationId } });
  await dbQuery("organizationProfile", "create", {
    data: {
      organizationId,
      legalName: "Acme Legal Name LLC",
      country: "United States",
      currency: "USD",
      timezone: "Asia/Singapore",
    },
  });
}

test.describe("Company Profile — timezone persistence diagnostic", () => {
  let fixtures: TestFixtures;

  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test.beforeEach(async () => {
    await seedSingaporeProfile(fixtures.orgA.id);
  });

  test.afterEach(async () => {
    await dbQuery("organizationProfile", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
  });

  test("changing a persisted timezone from Asia/Singapore to Asia/Bangkok: visible immediately after save, survives a real reload, and survives navigating away and back", async ({
    page,
    context,
    baseURL,
  }) => {
    await injectTestSession(context, fixtures.owner, baseURL!);

    await page.goto(COMPANY_PROFILE_PATH);
    await expect(page.getByLabel("Time zone")).toHaveValue("Asia/Singapore");

    await page.getByLabel("Time zone").selectOption("Asia/Bangkok");
    await Promise.all([
      page.waitForResponse((r) => r.url().includes(COMPANY_PROFILE_PATH) && r.request().method() === "POST"),
      page.getByRole("button", { name: "Save company profile" }).click(),
    ]);
    await expect(page.getByText("Company profile saved.")).toBeVisible();

    // Step 7 — the visible select value immediately after save.
    await expect(page.getByLabel("Time zone")).toHaveValue("Asia/Bangkok");

    // Cross-check the actual persisted row, independent of what the DOM shows.
    const persisted = await dbQuery<{ timezone: string } | null>("organizationProfile", "findUnique", {
      where: { organizationId: fixtures.orgA.id },
      select: { timezone: true },
    });
    expect(persisted?.timezone).toBe("Asia/Bangkok");

    // Step 8/9 — an actual full page reload.
    await page.reload();
    await expect(page.getByLabel("Time zone")).toHaveValue("Asia/Bangkok");

    // Step 10/11 — navigate away to another Staff route and back.
    await page.goto("/dashboard");
    await page.goto(COMPANY_PROFILE_PATH);
    await expect(page.getByLabel("Time zone")).toHaveValue("Asia/Bangkok");
  });

  test("browser back/forward restoration also reflects the persisted Asia/Bangkok value (kept separate from the primary save/reload assertion above)", async ({
    page,
    context,
    baseURL,
  }) => {
    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.goto(COMPANY_PROFILE_PATH);
    await expect(page.getByLabel("Time zone")).toHaveValue("Asia/Singapore");

    await page.getByLabel("Time zone").selectOption("Asia/Bangkok");
    await Promise.all([
      page.waitForResponse((r) => r.url().includes(COMPANY_PROFILE_PATH) && r.request().method() === "POST"),
      page.getByRole("button", { name: "Save company profile" }).click(),
    ]);
    await expect(page.getByText("Company profile saved.")).toBeVisible();

    await page.goto("/dashboard");
    await page.goBack();
    await expect(page.getByLabel("Time zone")).toHaveValue("Asia/Bangkok");
  });
});
