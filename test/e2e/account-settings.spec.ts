import { test, expect, type Page } from "@playwright/test";
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

// Page scripts are served as /_next/static/**.js chunks; holding them keeps the
// server-rendered HTML interactive-looking but un-hydrated.
const PAGE_SCRIPTS = /\/_next\/static\/.*\.js(\?.*)?$/;

const HYDRATION_ERROR = /Minified React error|hydrat/i;

/**
 * Resolves once React has hydrated the app shell, observed through behaviour
 * rather than React internals: the top bar's Search button only opens its
 * dialog after hydration attaches its handler. The app shell and this page are
 * one React root with no Suspense boundary between them, so a hydrated shell
 * means a hydrated form. The dialog is closed again so it cannot block the page.
 */
async function waitForAppShellHydrated(page: Page): Promise<void> {
  await expect(async () => {
    await page.getByRole("button", { name: "Search (Cmd+K)" }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 500 });
  }).toPass();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
}

/** Remembers the first #phone element the browser sees, so a later check can prove hydration adopted it instead of replacing it. */
async function trackPhoneInputNode(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __phoneNode?: Element };
    new MutationObserver(() => {
      const el = document.getElementById("phone");
      if (el && !w.__phoneNode) w.__phoneNode = el;
    }).observe(document, { childList: true, subtree: true });
  });
}

function isOriginalPhoneNode(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const w = window as unknown as { __phoneNode?: Element };
    return !!w.__phoneNode && document.getElementById("phone") === w.__phoneNode;
  });
}

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

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

  test("hydration adopts the server-rendered form: no React hydration error, and the phone input is the same DOM node", async ({
    page,
    context,
    baseURL,
  }) => {
    await injectTestSession(context, fixtures.owner, baseURL!);
    const pageErrors = collectPageErrors(page);
    await trackPhoneInputNode(page);
    await page.goto(ACCOUNT_PATH);
    await expect(page.getByLabel("Phone number")).toBeVisible();

    await waitForAppShellHydrated(page);

    expect(pageErrors.filter((message) => HYDRATION_ERROR.test(message))).toEqual([]);
    expect(await isOriginalPhoneNode(page)).toBe(true);
  });

  test("text typed and a country chosen before hydration survive it, and the invalid phone is still rejected with no stored mutation", async ({
    page,
    context,
    baseURL,
  }) => {
    await injectTestSession(context, fixtures.owner, baseURL!);
    const pageErrors = collectPageErrors(page);
    await trackPhoneInputNode(page);

    let heldScripts = 0;
    let releaseScripts!: () => void;
    const scriptGate = new Promise<void>((resolve) => {
      releaseScripts = resolve;
    });
    await page.route(PAGE_SCRIPTS, async (route) => {
      heldScripts += 1;
      await scriptGate;
      await route.continue();
    });

    try {
      // Server-rendered HTML only: no script has run, so nothing is hydrated yet.
      await page.goto(ACCOUNT_PATH, { waitUntil: "commit" });
      const phone = page.getByLabel("Phone number");
      const country = page.getByLabel("Country");
      await expect(phone).toBeVisible();

      await country.selectOption("US");
      await phone.fill("123");
      await expect(phone).toHaveValue("123");
      await expect(country).toHaveValue("US");
      expect(heldScripts).toBeGreaterThan(0);

      releaseScripts();
      await waitForAppShellHydrated(page);

      await expect(phone).toHaveValue("123");
      await expect(country).toHaveValue("US");
      expect(await isOriginalPhoneNode(page)).toBe(true);
      expect(pageErrors.filter((message) => HYDRATION_ERROR.test(message))).toEqual([]);

      await page.getByRole("button", { name: "Add phone number" }).click();
      await expect(page.getByText("Enter a valid phone number.")).toBeVisible();
      await expect.poll(() => userPhoneRow(fixtures.owner.id)).toMatchObject({ phone: null });
    } finally {
      // Always release held scripts (an assertion above may have failed first)
      // so no request or route is left hanging.
      releaseScripts();
      await page.unroute(PAGE_SCRIPTS);
    }
  });

  test("typing formats as you type for the selected country, and the phone field clears after both a failed and a successful submit", async ({
    page,
    context,
    baseURL,
  }) => {
    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.goto(ACCOUNT_PATH);
    await waitForAppShellHydrated(page);

    const phone = page.getByLabel("Phone number");
    const country = page.getByLabel("Country");

    await phone.pressSequentially("0812345678");
    await expect(phone).toHaveValue("081 234 5678");

    await phone.fill("");
    await country.selectOption("US");
    await phone.pressSequentially("2125551234");
    await expect(phone).toHaveValue("(212) 555-1234");

    await phone.fill("");
    await country.selectOption("TH");
    await phone.pressSequentially("123");
    await page.getByRole("button", { name: "Add phone number" }).click();
    await expect(page.getByText("Enter a valid phone number.")).toBeVisible();
    await expect(phone).toHaveValue("");
    await expect(country).toHaveValue("TH");

    await phone.pressSequentially("0812345678");
    await page.getByRole("button", { name: "Add phone number" }).click();
    await expect(page.getByText("Recovery phone saved.")).toBeVisible();
    await expect(page.getByLabel("New phone number")).toHaveValue("");
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

  /**
   * Production defect regression (confirmed via manual report + this
   * exact empirical reproduction before the fix): the country selector
   * reset to Afghanistan (+93) immediately after a successful or failed
   * Save/Remove server action, never actually losing the right value in
   * the DB (E.164 normalization/persistence were always correct — this
   * is purely a post-action client remount/form-state defect) but
   * displaying the wrong country until a full reload. See
   * recovery-phone-settings.tsx's own doc comment for the full root
   * cause. This test reproduces the exact Production sequence from the
   * defect report end to end, with no reload between steps.
   */
  test("country selector never shows the browser's native reset artifact (Afghanistan) after Add, Replace, or Remove — only the real selection", async ({
    page,
    context,
    baseURL,
  }) => {
    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.goto(ACCOUNT_PATH);

    const country = page.getByLabel("Country");
    await expect(country).toHaveValue("TH");

    // A. Add a valid Thai number — country must stay Thailand immediately,
    // with no reload.
    await page.getByLabel("Phone number").fill("081-234-5678");
    await page.getByRole("button", { name: "Add phone number" }).click();
    await expect(page.getByText("Recovery phone saved.")).toBeVisible();
    await expect(country).toHaveValue("TH");
    await expect(country).not.toHaveValue("AF");

    // B. Replace with a different Thai number — still Thailand, still no
    // reload, still never the Afghanistan artifact.
    await page.getByLabel("New phone number").fill("089-999-8888");
    await page.getByRole("button", { name: "Save new number" }).click();
    await expect(page.getByText("Recovery phone saved.")).toBeVisible();
    await expect(country).toHaveValue("TH");
    await expect(country).not.toHaveValue("AF");

    // C. Remove — returns immediately to the real default (Thailand),
    // never the browser's own alphabetically-first artifact.
    await page.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText("No recovery phone added.")).toBeVisible();
    await expect(country).toHaveValue("TH");
    await expect(country).not.toHaveValue("AF");

    // D. A full reload reproduces the identical (correct) state — the
    // fix doesn't depend on reload to "fix itself".
    await page.reload();
    await expect(country).toHaveValue("TH");
  });

  test("country selector preserves the user's own explicit choice after a FAILED submission — never resets to Afghanistan or to Thailand", async ({
    page,
    context,
    baseURL,
  }) => {
    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.goto(ACCOUNT_PATH);

    const country = page.getByLabel("Country");
    await country.selectOption("US");
    await page.getByLabel("Phone number").fill("123");
    await page.getByRole("button", { name: "Add phone number" }).click();

    await expect(page.getByText("Enter a valid phone number.")).toBeVisible();
    await expect(country).toHaveValue("US");
    await expect(country).not.toHaveValue("AF");
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
