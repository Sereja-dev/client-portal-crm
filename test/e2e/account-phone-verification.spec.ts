import { test, expect } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Phone Recovery, Slice B2. End to end through the REAL /settings/account
 * page and the REAL sendRecoveryPhoneVerificationCodeAction/
 * verifyRecoveryPhoneCodeAction Server Actions — TEST_MODE (set by
 * playwright.config.ts's own webServer.env, same as every other E2E spec)
 * makes checkPhoneVerificationProviderReadiness() report "ready" and
 * routes twilio-verify.ts's own sendCode/verifyCode through its
 * deterministic in-memory fake — no real Twilio, no real SMS, anywhere
 * in this file.
 *
 * RECOVERY_PHONE_SEND_CODE_LIMIT (src/lib/rate-limit/limits.ts) is a
 * real, per-user, per-hour limiter shared across this entire E2E run
 * (one long-lived `next start` process backs the whole suite — the same
 * in-memory store every other rate-limited E2E spec already shares).
 * This file's own 8 tests each send at least once; deliberately split
 * across TWO fixture identities (owner for the first 4, admin for the
 * rest) so neither one approaches the real 5/hour ceiling within one
 * normal run — proving the limiter still allows genuine, spread-out
 * usage rather than quietly raising it to make a large test file fit
 * under one identity.
 */

const ACCOUNT_PATH = "/settings/account";
// Must match twilio-verify.ts's own TEST_MODE_CODE constant exactly —
// the same "E2E has no real OTP mailbox, so it needs its own local copy
// of the deterministic value" pattern test/e2e/password-reset.spec.ts's
// own header comment already documents for recovery-token.ts.
const TEST_MODE_OTP_CODE = "000000";

function userPhoneState(userId: string) {
  return dbQuery<{ phone: string | null; phoneVerifiedAt: string | null } | null>("user", "findUnique", {
    where: { id: userId },
    select: { phone: true, phoneVerifiedAt: true },
  });
}

test.describe("Phone Recovery, Slice B2 — Account settings, Send/Verify", () => {
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

  test("send verification code shows the code-entry UI, never claims password recovery is live", async ({
    page,
    context,
    baseURL,
  }) => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { phone: "+66812345678" } });
    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.goto(ACCOUNT_PATH);

    await expect(page.getByText("Verify this number before it can be used for account recovery.")).toBeVisible();
    await page.getByRole("button", { name: "Send verification code" }).click();

    await expect(page.getByLabel("Verification code")).toBeVisible();
    await expect(page.getByRole("button", { name: "Verify code" })).toBeVisible();
    const body = await page.textContent("body");
    expect(body).not.toMatch(/password recovery.*live|recovery.*now available/i);
  });

  test("entering the known TEST_MODE code verifies the phone; the DB and UI both reflect Verified", async ({
    page,
    context,
    baseURL,
  }) => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { phone: "+66812345678" } });
    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.goto(ACCOUNT_PATH);

    await page.getByRole("button", { name: "Send verification code" }).click();
    await page.getByLabel("Verification code").fill(TEST_MODE_OTP_CODE);
    await page.getByRole("button", { name: "Verify code" }).click();

    await expect(page.getByText("Verified", { exact: true })).toBeVisible();
    await expect.poll(() => userPhoneState(fixtures.owner.id)).toMatchObject({
      phone: "+66812345678",
      phoneVerifiedAt: expect.any(String),
    });

    // Verified-phone read-only contract (B1) still holds in B2.
    await expect(page.getByLabel("Verification code")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);
  });

  test("a wrong code is rejected with a truthful generic error; phone stays unverified", async ({
    page,
    context,
    baseURL,
  }) => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { phone: "+66812345678" } });
    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.goto(ACCOUNT_PATH);

    await page.getByRole("button", { name: "Send verification code" }).click();
    await page.getByLabel("Verification code").fill("999999");
    await page.getByRole("button", { name: "Verify code" }).click();

    await expect(page.getByText("That code is invalid or has expired. Request a new one.")).toBeVisible();
    await expect.poll(() => userPhoneState(fixtures.owner.id)).toMatchObject({ phoneVerifiedAt: null });
  });

  test("reload after successful verification persists the Verified state (server-backed, not client-local)", async ({
    page,
    context,
    baseURL,
  }) => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { phone: "+66812345678" } });
    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.goto(ACCOUNT_PATH);

    await page.getByRole("button", { name: "Send verification code" }).click();
    await page.getByLabel("Verification code").fill(TEST_MODE_OTP_CODE);
    await page.getByRole("button", { name: "Verify code" }).click();
    await expect(page.getByText("Verified", { exact: true })).toBeVisible();

    await page.reload();

    await expect(page.getByText("Verified", { exact: true })).toBeVisible();
  });

  test("CRITICAL: replacing the phone after Send, then submitting the OLD code, fails — the new phone is never marked verified off a stale code", async ({
    page,
    context,
    baseURL,
  }) => {
    await dbQuery("user", "update", { where: { id: fixtures.admin.id }, data: { phone: "+66812345678" } });
    await injectTestSession(context, fixtures.admin, baseURL!);
    await page.goto(ACCOUNT_PATH);

    // 1. Send a code to the current phone (+66812345678).
    await page.getByRole("button", { name: "Send verification code" }).click();
    await expect(page.getByLabel("Verification code")).toBeVisible();

    // 2. Replace the stored phone, without reloading — the code-entry
    // box (deliberately not reset by this, see recovery-phone-settings.tsx's
    // own doc comment) stays exactly as it was.
    await page.getByLabel("New phone number").fill("089-999-8888");
    await page.getByRole("button", { name: "Save new number" }).click();
    await expect(page.getByText("Recovery phone saved.")).toBeVisible();
    await expect.poll(() => userPhoneState(fixtures.admin.id)).toMatchObject({ phone: "+66899998888" });

    // 3. Submit the code that was issued for the OLD phone number.
    await page.getByLabel("Verification code").fill(TEST_MODE_OTP_CODE);
    await page.getByRole("button", { name: "Verify code" }).click();

    await expect(page.getByText("That code is invalid or has expired. Request a new one.")).toBeVisible();
    await expect.poll(() => userPhoneState(fixtures.admin.id)).toMatchObject({
      phone: "+66899998888",
      phoneVerifiedAt: null,
    });
  });

  test("resend cooldown: the button is disabled with a countdown immediately after sending", async ({
    page,
    context,
    baseURL,
  }) => {
    // Deliberately no page.clock here — observed to interact
    // unreliably with this app's own hydration/Server-Action timing
    // across repeated runs (non-deterministic failures to even reach
    // the code-entry UI). The cooldown is a UX nicety, never the
    // security boundary (see actions.ts's own RECOVERY_PHONE_SEND_CODE_LIMIT
    // doc comment), so this asserts the one thing that matters without
    // depending on a 30-second real-time wait or a flaky fake-timer
    // interaction: spamming the button is impossible immediately after
    // a send, full stop.
    await dbQuery("user", "update", { where: { id: fixtures.admin.id }, data: { phone: "+66812345678" } });
    await injectTestSession(context, fixtures.admin, baseURL!);
    await page.goto(ACCOUNT_PATH);

    await page.getByRole("button", { name: "Send verification code" }).click();
    await expect(page.getByLabel("Verification code")).toBeVisible();

    const resendButton = page.getByRole("button", { name: /^Resend code/ });
    await expect(resendButton).toBeDisabled();
    await expect(resendButton).toHaveText(/Resend code \(\d+s\)/);
  });
});

test.describe("Phone Recovery, Slice B2 — Account settings, mobile viewport", () => {
  let fixtures: TestFixtures;

  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test.afterEach(async () => {
    await dbQuery("user", "update", {
      where: { id: fixtures.admin.id },
      data: { phone: null, phoneVerifiedAt: null },
    });
  });

  // Both mobile checks use `admin` (not `owner`) — see the describe
  // block above's own header comment on spreading this file's sends
  // across two fixture identities to stay well under
  // RECOVERY_PHONE_SEND_CODE_LIMIT within one normal (non-repeated) run.
  for (const width of [390, 320]) {
    test(`send + verify flow renders without horizontal overflow at ${width}px`, async ({ page, context, baseURL }) => {
      await page.setViewportSize({ width, height: 800 });
      await dbQuery("user", "update", { where: { id: fixtures.admin.id }, data: { phone: "+66812345678" } });
      await injectTestSession(context, fixtures.admin, baseURL!);
      await page.goto(ACCOUNT_PATH);

      const hasOverflowBeforeSend = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(hasOverflowBeforeSend).toBe(false);

      await page.getByRole("button", { name: "Send verification code" }).click();
      await expect(page.getByLabel("Verification code")).toBeVisible();

      const hasOverflowAfterSend = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(hasOverflowAfterSend).toBe(false);

      await page.getByLabel("Verification code").fill(TEST_MODE_OTP_CODE);
      await page.getByRole("button", { name: "Verify code" }).click();
      await expect(page.getByText("Verified", { exact: true })).toBeVisible();
    });
  }
});
