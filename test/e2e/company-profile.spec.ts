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

  test("Failed-Validation Form State Preservation — a rejected submission preserves every valid field the user just entered, never reverting them to the old persisted profile, and a corrected resubmission then persists all of them", async ({
    page,
    context,
    baseURL,
  }) => {
    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.goto(COMPANY_PROFILE_PATH);

    // Starting persisted state, per seedSingaporeProfile's own beforeEach:
    // legalName "Acme Legal Name LLC", currency USD, timezone Asia/Singapore.
    await expect(page.getByLabel("Legal company name")).toHaveValue("Acme Legal Name LLC");
    await expect(page.getByLabel("Currency")).toHaveValue("USD");
    await expect(page.getByLabel("Time zone")).toHaveValue("Asia/Singapore");

    // Change three genuinely valid fields, then deliberately break a
    // fourth (Brand color) so the whole submission is rejected.
    await page.getByLabel("Legal company name").fill("New Name");
    await page.getByLabel("Time zone").selectOption("Asia/Bangkok");
    await page.getByLabel("Currency").selectOption("EUR");
    await page.getByLabel("Brand color").fill("not-a-color");

    await Promise.all([
      page.waitForResponse((r) => r.url().includes(COMPANY_PROFILE_PATH) && r.request().method() === "POST"),
      page.getByRole("button", { name: "Save company profile" }).click(),
    ]);

    // The submission was genuinely rejected -- validation error visible,
    // no success message.
    await expect(page.getByText("Enter a color as #RRGGBB.")).toBeVisible();
    await expect(page.getByText("Company profile saved.")).not.toBeVisible();

    // Every valid field the user just entered survives, unaffected by
    // the unrelated field's own validation failure.
    await expect(page.getByLabel("Legal company name")).toHaveValue("New Name");
    await expect(page.getByLabel("Time zone")).toHaveValue("Asia/Bangkok");
    await expect(page.getByLabel("Currency")).toHaveValue("EUR");

    // The DB must still hold the old, untouched, persisted values.
    const afterFailedSubmit = await dbQuery<{ legalName: string; timezone: string; currency: string } | null>(
      "organizationProfile",
      "findUnique",
      { where: { organizationId: fixtures.orgA.id }, select: { legalName: true, timezone: true, currency: true } },
    );
    expect(afterFailedSubmit?.legalName).toBe("Acme Legal Name LLC");
    expect(afterFailedSubmit?.timezone).toBe("Asia/Singapore");
    expect(afterFailedSubmit?.currency).toBe("USD");

    // Correct only the invalid field and resubmit.
    await page.getByLabel("Brand color").fill("#112233");
    await Promise.all([
      page.waitForResponse((r) => r.url().includes(COMPANY_PROFILE_PATH) && r.request().method() === "POST"),
      page.getByRole("button", { name: "Save company profile" }).click(),
    ]);
    await expect(page.getByText("Company profile saved.")).toBeVisible();

    // Every value entered across both submissions is now persisted --
    // not just the one changed in the final, successful attempt.
    const afterSuccess = await dbQuery<{ legalName: string; timezone: string; currency: string; brandColor: string } | null>(
      "organizationProfile",
      "findUnique",
      { where: { organizationId: fixtures.orgA.id }, select: { legalName: true, timezone: true, currency: true, brandColor: true } },
    );
    expect(afterSuccess?.legalName).toBe("New Name");
    expect(afterSuccess?.timezone).toBe("Asia/Bangkok");
    expect(afterSuccess?.currency).toBe("EUR");
    expect(afterSuccess?.brandColor).toBe("#112233");

    // A real hard reload confirms the visible form matches, not just the DB.
    await page.reload();
    await expect(page.getByLabel("Legal company name")).toHaveValue("New Name");
    await expect(page.getByLabel("Time zone")).toHaveValue("Asia/Bangkok");
    await expect(page.getByLabel("Currency")).toHaveValue("EUR");
    await expect(page.getByLabel("Brand color")).toHaveValue("#112233");
  });
});
