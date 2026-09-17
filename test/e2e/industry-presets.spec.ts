import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Industry Presets V1 — real-browser coverage (locked spec §17.C, 14
 * minimum steps). Domain-layer correctness (conflict semantics, apply
 * transaction/atomicity, replay/idempotency, authorization, tenant
 * isolation, rollback, side-effect absence, onboarding wiring) is
 * already exhaustively covered by test/integration/industry-presets/
 * apply.test.ts — this file only covers what genuinely needs a real
 * browser: the four preset cards, preview ADD/SKIP presentation, the
 * real Apply click and its resulting "Applied" state, that the created
 * configuration is actually visible on the real Custom Statuses/Custom
 * Fields/Tags pages, MEMBER's view-only access, and mobile/tablet/
 * desktop layout — mirroring tags.spec.ts/custom-statuses-settings.spec.ts's
 * own structure and technique.
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

function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

async function cleanupPresetArtifacts(): Promise<void> {
  await dbQuery("presetApplication", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
  await dbQuery("customFieldOption", "deleteMany", { where: { definition: { organizationId: fixtures.orgA.id } } });
  await dbQuery("customFieldDefinition", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
  await dbQuery("customStatusDefinition", "deleteMany", { where: { organizationId: fixtures.orgA.id, isSystem: false } });
  await dbQuery("tagAssignment", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
  await dbQuery("tag", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
  await dbQuery("organizationOnboardingStep", "deleteMany", {
    where: { organizationId: fixtures.orgA.id, step: "INDUSTRY_PRESET" },
  });
}

test.describe("Industry Presets V1 — Staff UI", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterEach(async () => {
    await cleanupPresetArtifacts();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test.describe("Settings → Industry Presets", () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await actAsOwner(context, baseURL!);
    });

    test("1-6. four cards render; preview shows Will add items; Applying shows success and Applied state, visible in Custom Statuses/Custom Fields/Tags, persists on reload, and a different preset can no longer be applied", async ({
      page,
    }) => {
      const errors = trackConsoleErrors(page);

      // 1. Four cards render.
      await page.goto("/settings/industry-presets");
      await expect(page.getByRole("heading", { name: "Industry Presets" })).toBeVisible();
      await expect(page.getByRole("link", { name: /Freelancer \/ Solo Consultant/ })).toBeVisible();
      await expect(page.getByRole("link", { name: /Creative \/ Design Agency/ })).toBeVisible();
      await expect(page.getByRole("link", { name: /Marketing \/ Digital Agency/ })).toBeVisible();
      await expect(page.getByRole("link", { name: /General Services/ })).toBeVisible();

      // 2. Preview one preset -- shows "Will add" items.
      await page.getByRole("link", { name: /Freelancer \/ Solo Consultant/ }).click();
      await expect(page.getByRole("heading", { name: "Freelancer / Solo Consultant" })).toBeVisible();
      await expect(
        page.getByText("Applying this preset only adds new configuration. Existing statuses, fields, and tags will"),
      ).toBeVisible();
      await expect(page.getByText("Retainer (client)")).toBeVisible();
      const retainerRow = page.getByText("Retainer (client)").locator("..");
      await expect(retainerRow.getByText("Will add")).toBeVisible();

      // 3. Apply -- success state, page shows Applied.
      await page.getByRole("button", { name: "Apply Freelancer / Solo Consultant" }).click();
      await expect(page.getByText("Applied", { exact: true })).toBeVisible();

      // 4. Custom Statuses/Custom Fields/Tags reflect the created configuration.
      await page.goto("/settings/custom-statuses?entity=CLIENT");
      await expect(page.getByText("Retainer").first()).toBeVisible();

      await page.goto("/settings/custom-fields?entity=LEAD");
      await expect(page.getByText("Service Interest").first()).toBeVisible();

      await page.goto("/settings/tags");
      await expect(page.getByRole("row", { name: /Referral/ })).toBeVisible();

      // 5. Reload Industry Presets -- same preset remains Applied.
      await page.goto("/settings/industry-presets");
      await expect(page.getByRole("link", { name: /Freelancer \/ Solo Consultant/ }).getByText("Applied")).toBeVisible();

      // 6. A different preset cannot be applied.
      await page.getByRole("link", { name: /Creative \/ Design Agency/ }).click();
      await expect(page.getByText(/already applied.*Freelancer/)).toBeVisible();
      await expect(page.getByRole("button", { name: /Apply Creative/ })).toHaveCount(0);

      expect(errors).toEqual([]);
    });

    test("8. conflict preview: a pre-seeded conflicting status shows Will skip, everything else still shows Will add", async ({
      page,
    }) => {
      await dbQuery("customStatusDefinition", "create", {
        data: {
          organizationId: fixtures.orgA.id,
          entityType: "LEAD",
          key: "negotiation",
          label: "Negotiation (pre-existing)",
          position: 50,
          isSystem: false,
          isDefault: false,
        },
      });

      await page.goto("/settings/industry-presets/freelancer");
      const conflictRow = page.getByText("Negotiation (lead)").locator("..");
      await expect(conflictRow.getByText("Will skip")).toBeVisible();
      const safeRow = page.getByText("Follow-up (lead)").locator("..");
      await expect(safeRow.getByText("Will add")).toBeVisible();
    });
  });

  test.describe("MEMBER can view/preview but not apply", () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await actAsMember(context, baseURL!);
    });

    test("7. MEMBER can open the list and a preview, but no Apply button is offered", async ({ page }) => {
      await page.goto("/settings/industry-presets");
      await expect(page.getByRole("heading", { name: "Industry Presets" })).toBeVisible();

      await page.getByRole("link", { name: /Freelancer \/ Solo Consultant/ }).click();
      await expect(page.getByText("Retainer (client)")).toBeVisible();
      await expect(page.getByRole("button", { name: /^Apply/ })).toHaveCount(0);
      await expect(page.getByText("You don't have permission to apply a preset.")).toBeVisible();
    });
  });

  test.describe("Onboarding", () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await actAsOwner(context, baseURL!);
    });

    test("9. the Industry Preset onboarding step is available, Skip works, and applying from Settings marks it complete", async ({
      page,
    }) => {
      await page.goto("/dashboard");
      const onboardingCard = page.getByRole("region", { name: "Getting started" });
      const row = onboardingCard.getByRole("listitem").filter({ hasText: "Choose an industry preset" });
      await expect(row).toBeVisible();
      await expect(row.getByRole("link", { name: /Go to/ })).toBeVisible();

      await row.getByRole("button", { name: /Skip/ }).click();
      await expect(row.getByText("Skipped", { exact: true })).toBeVisible();

      // Undo the skip so the apply path below is exercised from a clean NOT_STARTED state.
      await dbQuery("organizationOnboardingStep", "deleteMany", {
        where: { organizationId: fixtures.orgA.id, step: "INDUSTRY_PRESET" },
      });

      await page.goto("/settings/industry-presets/general_services");
      await page.getByRole("button", { name: "Apply General Services" }).click();
      await expect(page.getByText("Applied", { exact: true })).toBeVisible();

      await page.goto("/dashboard");
      const rowAfter = onboardingCard.getByRole("listitem").filter({ hasText: "Choose an industry preset" });
      await expect(rowAfter.getByText("Complete", { exact: true })).toBeVisible();
    });
  });

  test.describe("responsive", () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await actAsOwner(context, baseURL!);
    });

    async function expectNoOverflow(page: Page): Promise<void> {
      const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(hasOverflow).toBe(false);
    }

    test("390px: preset cards and preview remain usable with no page-level horizontal overflow", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/settings/industry-presets");
      await expect(page.getByRole("link", { name: /Freelancer \/ Solo Consultant/ })).toBeVisible();
      await expectNoOverflow(page);

      await page.getByRole("link", { name: /Freelancer \/ Solo Consultant/ }).click();
      await expect(page.getByText("Retainer (client)")).toBeVisible();
      await expectNoOverflow(page);
      await expect(page.getByRole("button", { name: "Apply Freelancer / Solo Consultant" })).toBeVisible();
    });

    test("834px: preset cards grid and preview groups remain usable, no overflow", async ({ page }) => {
      await page.setViewportSize({ width: 834, height: 1100 });
      await page.goto("/settings/industry-presets");
      await expect(page.getByRole("link", { name: /Creative \/ Design Agency/ })).toBeVisible();
      await expectNoOverflow(page);
    });

    test("1280px: full desktop layout, no overflow", async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto("/settings/industry-presets");
      await expect(page.getByRole("link", { name: /Marketing \/ Digital Agency/ })).toBeVisible();
      await expectNoOverflow(page);
    });
  });
});
