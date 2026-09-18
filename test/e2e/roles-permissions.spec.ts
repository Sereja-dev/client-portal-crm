import { test, expect } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Roles / Permissions V1 — focused E2E for the management flow (locked
 * spec §29): OWNER opens /team/permissions, changes one MEMBER
 * permission, saves, sees the success state, and the change survives a
 * reload. Desktop viewport (1280px) throughout so the real `<table>`
 * (not the mobile role-tab layout) is exercised — the table's checkbox
 * for a given (permission, role) pair is directly addressable via its
 * accessible label, so this doesn't depend on which layout renders.
 */

let fixtures: TestFixtures;

test.beforeAll(async () => {
  fixtures = await seedE2EFixtures();
});

test.afterAll(async () => {
  await cleanupTestData(fixtures);
});

test.describe("Roles & permissions management", () => {
  test.beforeEach(async ({ context, baseURL, page }) => {
    await injectTestSession(context, { id: fixtures.owner.id, email: fixtures.owner.email }, baseURL!);
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  test("OWNER grants Member the Tags permission, saves, and the change persists across reload", async ({ page }) => {
    await page.goto("/team/permissions");
    await expect(page.getByRole("heading", { name: "Roles & permissions" })).toBeVisible();

    const tagsForMember = page.getByLabel("Tags for Member");
    await expect(tagsForMember).not.toBeChecked();

    const saveButton = page.getByRole("button", { name: "Save" });
    await expect(saveButton).toBeDisabled();

    await tagsForMember.check();
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    await expect(page.getByRole("status").filter({ hasText: "Permissions saved." })).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Tags for Member")).toBeChecked();

    // Clean up: restore the default so this test is repeatable and leaves no lasting override.
    await page.getByLabel("Tags for Member").uncheck();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Permissions saved." })).toBeVisible();
  });

  test("ADMIN and MEMBER cannot reach the management page", async ({ context, baseURL, page }) => {
    await injectTestSession(context, { id: fixtures.admin.id, email: fixtures.admin.email }, baseURL!);
    await page.goto("/team/permissions");
    await expect(page.getByText("Roles & permissions are only available to the organization owner.")).toBeVisible();

    await injectTestSession(context, { id: fixtures.member.id, email: fixtures.member.email }, baseURL!);
    await page.goto("/team/permissions");
    await expect(page.getByText("Roles & permissions are only available to the organization owner.")).toBeVisible();
  });
});
