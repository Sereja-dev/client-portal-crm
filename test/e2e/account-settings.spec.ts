import { test, expect } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Phone Recovery Foundation, Slice B1 (read-only architecture audit:
 * PHONE_RECOVERY_AUDIT). End to end through the REAL /settings/account
 * page (not a synthetic harness) — real `injectTestSession` + real
 * fixtures exercise the actual getOrCreateUser()/updateRecoveryPhoneAction
 * stack exactly the way Production does. No real SMS anywhere in this
 * file — B1 never sends one, and nothing here asserts one was sent.
 * Mirrors appearance-settings.spec.ts's own structure (desktop describe
 * + a separate mobile-viewport describe).
 */

const ACCOUNT_PATH = "/settings/account";

function userPhoneRow(userId: string) {
  return dbQuery<{ phone: string | null; phoneVerifiedAt: string | null } | null>("user", "findUnique", {
    where: { id: userId },
    select: { phone: true, phoneVerifiedAt: true },
  });
}

test.describe("Phone Recovery Foundation, Slice B1 — Account settings, Recovery phone section", () => {
  let fixtures: TestFixtures;

  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test.afterEach(async () => {
    await dbQuery("user", "update", {
      where: { id: fixtures.owner.id },
      data: { phone: null, phoneVerifiedAt: null },
    });
    await dbQuery("user", "update", {
      where: { id: fixtures.admin.id },
      data: { phone: null, phoneVerifiedAt: null },
    });
  });

  test("no phone: shows the empty state and a Save/Add form, no Remove control", async ({ page, context, baseURL }) => {
    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.goto(ACCOUNT_PATH);

    await expect(page.getByText("No recovery phone added.")).toBeVisible();
    await expect(page.getByLabel("Phone number")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add phone number" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);
  });

  test("adding a valid phone stores it normalized, and the page reflects the unverified state honestly", async ({
    page,
    context,
    baseURL,
  }) => {
    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.goto(ACCOUNT_PATH);

    await page.getByLabel("Phone number").fill("081-234-5678");
    await page.getByRole("button", { name: "Add phone number" }).click();

    await expect(page.getByText("Recovery phone saved.")).toBeVisible();
    await expect(page.getByText("Not verified", { exact: true })).toBeVisible();
    // Phone Recovery Slice B2 — TEST_MODE makes the verification
    // provider "ready" (see twilio-verify.ts's own checkPhoneVerificationProviderReadiness()),
    // so the real Send control appears here, not B1's old static
    // "coming soon" copy (see account-phone-verification.spec.ts for
    // full Send/Verify coverage) — this assertion only confirms the
    // honest "not yet recovery-eligible" framing survives B2 intact.
    await expect(page.getByText("Verify this number before it can be used for account recovery.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send verification code" })).toBeVisible();

    await expect.poll(() => userPhoneRow(fixtures.owner.id)).toMatchObject({
      phone: "+66812345678",
      phoneVerifiedAt: null,
    });
  });

  test("an invalid phone number is rejected, with no stored mutation", async ({ page, context, baseURL }) => {
    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.goto(ACCOUNT_PATH);

    await page.getByLabel("Phone number").fill("123");
    await page.getByRole("button", { name: "Add phone number" }).click();

    await expect(page.getByText("Enter a valid phone number.")).toBeVisible();
    await expect.poll(() => userPhoneRow(fixtures.owner.id)).toMatchObject({ phone: null });
  });

  test("a phone already used by a different Staff user is rejected, without disclosing who owns it", async ({
    page,
    context,
    baseURL,
  }) => {
    await dbQuery("user", "update", { where: { id: fixtures.admin.id }, data: { phone: "+66811112222" } });

    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.goto(ACCOUNT_PATH);
    await page.getByLabel("Phone number").fill("081-111-2222");
    await page.getByRole("button", { name: "Add phone number" }).click();

    await expect(page.getByText("This phone number is already in use.")).toBeVisible();
    const body = await page.textContent("body");
    expect(body).not.toContain(fixtures.admin.email);
  });

  test("replacing an unverified phone with a different number updates the stored value", async ({
    page,
    context,
    baseURL,
  }) => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { phone: "+66812345678" } });

    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.goto(ACCOUNT_PATH);

    await expect(page.getByRole("button", { name: "Save new number" })).toBeVisible();
    await page.getByLabel("New phone number").fill("089-999-8888");
    await page.getByRole("button", { name: "Save new number" }).click();

    await expect(page.getByText("Recovery phone saved.")).toBeVisible();
    await expect.poll(() => userPhoneRow(fixtures.owner.id)).toMatchObject({ phone: "+66899998888" });
  });

  test("removing an unverified phone returns to the empty state", async ({ page, context, baseURL }) => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { phone: "+66812345678" } });

    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.goto(ACCOUNT_PATH);
    await page.getByRole("button", { name: "Remove" }).click();

    await expect(page.getByText("No recovery phone added.")).toBeVisible();
    await expect.poll(() => userPhoneRow(fixtures.owner.id)).toMatchObject({ phone: null, phoneVerifiedAt: null });
  });

  test("a verified phone fixture renders read-only: no edit form, no Remove control, truthful 'Verified' copy", async ({
    page,
    context,
    baseURL,
  }) => {
    await dbQuery("user", "update", {
      where: { id: fixtures.owner.id },
      data: { phone: "+66812345678", phoneVerifiedAt: new Date().toISOString() },
    });

    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.goto(ACCOUNT_PATH);

    await expect(page.getByText("Verified", { exact: true })).toBeVisible();
    await expect(page.getByText("re-authentication support is added", { exact: false })).toBeVisible();
    await expect(page.getByLabel("Phone number")).toHaveCount(0);
    await expect(page.getByLabel("New phone number")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Save/ })).toHaveCount(0);
    // Masked, not the raw stored number.
    const body = await page.textContent("body");
    expect(body).not.toContain("+66812345678");
  });

  test("no 'Verify' control renders before a code has been sent (Slice B2's Verify step is reachable only after Send)", async ({
    page,
    context,
    baseURL,
  }) => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { phone: "+66812345678" } });
    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.goto(ACCOUNT_PATH);

    await expect(page.getByRole("button", { name: /^Verify/ })).toHaveCount(0);
  });

  test("the Account nav link is present and reachable from the Settings nav", async ({ page, context, baseURL }) => {
    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.goto("/settings/appearance");
    await page.getByRole("link", { name: "Account", exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/account$/);
    await expect(page.getByRole("heading", { name: "Recovery phone" })).toBeVisible();
  });
});

test.describe("Phone Recovery Foundation, Slice B1 — Account settings, mobile viewport", () => {
  let fixtures: TestFixtures;

  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test.afterEach(async () => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { phone: null, phoneVerifiedAt: null } });
  });

  for (const width of [390, 320]) {
    test(`renders without horizontal overflow at ${width}px, form remains usable`, async ({ page, context, baseURL }) => {
      await page.setViewportSize({ width, height: 800 });
      await injectTestSession(context, fixtures.owner, baseURL!);
      await page.goto(ACCOUNT_PATH);

      const hasOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(hasOverflow).toBe(false);

      await expect(page.getByLabel("Phone number")).toBeVisible();
      await page.getByLabel("Phone number").fill("081-234-5678");
      await page.getByRole("button", { name: "Add phone number" }).click();
      await expect(page.getByText("Recovery phone saved.")).toBeVisible();
    });
  }
});
