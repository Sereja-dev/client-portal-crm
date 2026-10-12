import { test, expect, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";
import { selectCurrencyOption } from "../support/select-currency-option";

/**
 * Forms Improvement Slice C1b — the one way to observe
 * UnsavedChangesScope's own `beforeunload` registration from outside
 * the page, since Playwright has no scriptable hook into a native
 * beforeunload dialog's registration state (the same limitation
 * documented in unsaved-changes-protection.spec.ts's own header
 * comment) and Company Settings has no local Cancel/Back control for a
 * ConfirmDialog-based proxy the way Invoice/Recurring Invoice/Quote's
 * own C1a tests use. This init script intercepts
 * `window.addEventListener`/`removeEventListener` for exactly the
 * `"beforeunload"` event type, before the app's own JS ever runs, and
 * keeps a running count — `useBeforeUnloadGuard`'s own add/remove pair
 * is the only thing in this app that ever registers one. A count above
 * zero means the real browser would currently prompt on hard unload;
 * zero means it would not. Nothing about the app itself is touched.
 */
async function installBeforeUnloadObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __beforeUnloadListenerCount: number }).__beforeUnloadListenerCount = 0;
    const originalAdd = window.addEventListener.bind(window) as (...args: unknown[]) => void;
    const originalRemove = window.removeEventListener.bind(window) as (...args: unknown[]) => void;
    window.addEventListener = ((type: string, ...rest: unknown[]) => {
      if (type === "beforeunload") {
        (window as unknown as { __beforeUnloadListenerCount: number }).__beforeUnloadListenerCount++;
      }
      return originalAdd(type, ...rest);
    }) as typeof window.addEventListener;
    window.removeEventListener = ((type: string, ...rest: unknown[]) => {
      if (type === "beforeunload") {
        (window as unknown as { __beforeUnloadListenerCount: number }).__beforeUnloadListenerCount--;
      }
      return originalRemove(type, ...rest);
    }) as typeof window.removeEventListener;
  });
}

async function isBeforeUnloadGuarded(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as { __beforeUnloadListenerCount: number }).__beforeUnloadListenerCount > 0);
}

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
    await selectCurrencyOption(page, "Currency", "EUR");
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

  /**
   * Company Settings Mid-Flight Edit Loss remediation — before this fix,
   * every CompanyProfileForm field stayed editable while a submission
   * was pending, so an edit made in that brief window was silently
   * discarded by React 19's own post-settlement native `form.reset()`
   * (on success *and* on a validation failure alike — the native reset
   * fires either way). The fix wraps every field in a single outer
   * `<fieldset disabled={pending}>`; these tests prove the editable
   * field itself is genuinely disabled while pending (not merely the
   * Save button, which already had its own separate `loading`-driven
   * disabled state), that the already-captured submitted FormData still
   * reaches the server uncorrupted, and that every existing success/
   * validation-failure/resubmit behavior is unchanged.
   */
  test.describe("Mid-flight edit loss remediation — pending fields are disabled, not merely the Save button", () => {
    test("success path: the field is disabled while the save is pending, re-enables after settlement, and the submitted value is both visible and persisted", async ({
      page,
      context,
      baseURL,
    }) => {
      await injectTestSession(context, fixtures.owner, baseURL!);
      await page.goto(COMPANY_PROFILE_PATH);

      const field = page.getByLabel("Legal company name");
      await field.fill("Mid-flight success name");

      const responsePromise = page.waitForResponse(
        (r) => r.url().includes(COMPANY_PROFILE_PATH) && r.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Save company profile" }).click();

      // The editable field itself -- not just the Save button -- is
      // genuinely disabled (native semantics) while the request is in
      // flight. A disabled control cannot receive focus or input, so
      // this is proof that no mid-flight edit can occur at all, not
      // merely that one happens not to have been attempted.
      await expect(field).toBeDisabled();

      await responsePromise;
      await expect(page.getByText("Company profile saved.")).toBeVisible();

      // Re-enabled, and showing exactly what was submitted.
      await expect(field).toBeEnabled();
      await expect(field).toHaveValue("Mid-flight success name");

      const persisted = await dbQuery<{ legalName: string } | null>("organizationProfile", "findUnique", {
        where: { organizationId: fixtures.orgA.id },
        select: { legalName: true },
      });
      expect(persisted?.legalName).toBe("Mid-flight success name");

      // The field is genuinely usable again, not merely re-rendered as
      // enabled in markup.
      await field.fill("Edited after settlement");
      await expect(field).toHaveValue("Edited after settlement");
    });

    test("validation-failure path: the field is disabled while pending, submitted values remain visible after the rejection, fields re-enable, and a corrected resubmit still succeeds", async ({
      page,
      context,
      baseURL,
    }) => {
      await injectTestSession(context, fixtures.owner, baseURL!);
      await page.goto(COMPANY_PROFILE_PATH);

      const field = page.getByLabel("Legal company name");
      await field.fill("Mid-flight failure name");
      // A real, existing validation rule, not invented for this test.
      await page.getByLabel("Brand color").fill("not-a-color");

      const responsePromise = page.waitForResponse(
        (r) => r.url().includes(COMPANY_PROFILE_PATH) && r.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Save company profile" }).click();
      await expect(field).toBeDisabled();

      await responsePromise;
      await expect(page.getByText("Enter a color as #RRGGBB.")).toBeVisible();

      // The submitted (valid) value survives the unrelated field's own
      // rejection, exactly as the existing Failed-Validation Form State
      // Preservation test already proves -- this fix must not regress
      // that.
      await expect(field).toHaveValue("Mid-flight failure name");
      await expect(field).toBeEnabled();

      // The DB is untouched -- the save genuinely failed.
      const afterFailure = await dbQuery<{ legalName: string } | null>("organizationProfile", "findUnique", {
        where: { organizationId: fixtures.orgA.id },
        select: { legalName: true },
      });
      expect(afterFailure?.legalName).toBe("Acme Legal Name LLC");

      // Corrected resubmit still works.
      await page.getByLabel("Brand color").fill("#445566");
      await Promise.all([
        page.waitForResponse((r) => r.url().includes(COMPANY_PROFILE_PATH) && r.request().method() === "POST"),
        page.getByRole("button", { name: "Save company profile" }).click(),
      ]);
      await expect(page.getByText("Company profile saved.")).toBeVisible();

      const afterSuccess = await dbQuery<{ legalName: string; brandColor: string } | null>(
        "organizationProfile",
        "findUnique",
        { where: { organizationId: fixtures.orgA.id }, select: { legalName: true, brandColor: true } },
      );
      expect(afterSuccess?.legalName).toBe("Mid-flight failure name");
      expect(afterSuccess?.brandColor).toBe("#445566");
    });

    test("CurrencySelect and the native Timezone select are also disabled while pending, re-enable after settlement, and the values chosen before submit persist correctly", async ({
      page,
      context,
      baseURL,
    }) => {
      await injectTestSession(context, fixtures.owner, baseURL!);
      await page.goto(COMPANY_PROFILE_PATH);

      await selectCurrencyOption(page, "Currency", "EUR");
      await page.getByLabel("Time zone").selectOption("Asia/Bangkok");

      const responsePromise = page.waitForResponse(
        (r) => r.url().includes(COMPANY_PROFILE_PATH) && r.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Save company profile" }).click();

      await expect(page.getByLabel("Currency")).toBeDisabled();
      await expect(page.getByLabel("Time zone")).toBeDisabled();

      await responsePromise;
      await expect(page.getByText("Company profile saved.")).toBeVisible();

      const persisted = await dbQuery<{ currency: string; timezone: string } | null>(
        "organizationProfile",
        "findUnique",
        { where: { organizationId: fixtures.orgA.id }, select: { currency: true, timezone: true } },
      );
      expect(persisted?.currency).toBe("EUR");
      expect(persisted?.timezone).toBe("Asia/Bangkok");

      await expect(page.getByLabel("Currency")).toBeEnabled();
      await expect(page.getByLabel("Time zone")).toBeEnabled();
    });
  });

  /**
   * Forms Improvement Slice C1b — Company Settings unsaved-change
   * protection. Approved scope: hard reload/tab-close/typed-URL via the
   * existing UnsavedChangesScope/beforeunload mechanism only — no local
   * Cancel/Back exists on this page (none is added here), and
   * SettingsNav/sidebar/browser Back-Forward remain unprotected
   * accepted limitations, matching C1a's own. See
   * `installBeforeUnloadObserver`'s own header comment for how dirty
   * state is observed here instead of via a ConfirmDialog.
   */
  test.describe("Forms Improvement Slice C1b — unsaved-change protection", () => {
    test("pristine form: no unsaved protection", async ({ page, context, baseURL }) => {
      await installBeforeUnloadObserver(page);
      await injectTestSession(context, fixtures.owner, baseURL!);
      await page.goto(COMPANY_PROFILE_PATH);

      await expect(page.getByLabel("Legal company name")).toHaveValue("Acme Legal Name LLC");
      await expect.poll(() => isBeforeUnloadGuarded(page)).toBe(false);
    });

    test("plain field: editing makes the form dirty; reverting to the exact original value makes it clean again", async ({
      page,
      context,
      baseURL,
    }) => {
      await installBeforeUnloadObserver(page);
      await injectTestSession(context, fixtures.owner, baseURL!);
      await page.goto(COMPANY_PROFILE_PATH);
      await expect.poll(() => isBeforeUnloadGuarded(page)).toBe(false);

      const field = page.getByLabel("Legal company name");
      await field.fill("Temporarily Different Name");
      await expect.poll(() => isBeforeUnloadGuarded(page)).toBe(true);

      await field.fill("Acme Legal Name LLC");
      await expect.poll(() => isBeforeUnloadGuarded(page)).toBe(false);
    });

    test("optional-field normalization: typing into an unset optional field and clearing it back to empty never produces a false-positive dirty state", async ({
      page,
      context,
      baseURL,
    }) => {
      await installBeforeUnloadObserver(page);
      await injectTestSession(context, fixtures.owner, baseURL!);
      await page.goto(COMPANY_PROFILE_PATH);

      // seedSingaporeProfile never sets supportEmail -- it is genuinely
      // unset (persisted as null), which this form's own baseline
      // normalizes the same way an empty submitted string would be.
      const supportEmail = page.getByLabel("Support email");
      await expect(supportEmail).toHaveValue("");
      await expect.poll(() => isBeforeUnloadGuarded(page)).toBe(false);

      await supportEmail.fill("temp@example.com");
      await expect.poll(() => isBeforeUnloadGuarded(page)).toBe(true);

      await supportEmail.fill("");
      await expect.poll(() => isBeforeUnloadGuarded(page)).toBe(false);
    });

    test("validation failure: a rejected save does NOT re-anchor the baseline -- the form remains dirty and protected afterward", async ({
      page,
      context,
      baseURL,
    }) => {
      await installBeforeUnloadObserver(page);
      await injectTestSession(context, fixtures.owner, baseURL!);
      await page.goto(COMPANY_PROFILE_PATH);

      await page.getByLabel("Legal company name").fill("Rejected Attempt Name");
      await page.getByLabel("Brand color").fill("not-a-color");

      await Promise.all([
        page.waitForResponse((r) => r.url().includes(COMPANY_PROFILE_PATH) && r.request().method() === "POST"),
        page.getByRole("button", { name: "Save company profile" }).click(),
      ]);
      await expect(page.getByText("Enter a color as #RRGGBB.")).toBeVisible();

      // Still dirty/protected -- the failed save must never have
      // promoted the baseline.
      await expect.poll(() => isBeforeUnloadGuarded(page)).toBe(true);
    });

    test("successful save: establishes a new clean baseline -- no unsaved protection immediately afterward", async ({
      page,
      context,
      baseURL,
    }) => {
      await installBeforeUnloadObserver(page);
      await injectTestSession(context, fixtures.owner, baseURL!);
      await page.goto(COMPANY_PROFILE_PATH);

      await page.getByLabel("Legal company name").fill("Successfully Saved Name");
      await expect.poll(() => isBeforeUnloadGuarded(page)).toBe(true);

      await Promise.all([
        page.waitForResponse((r) => r.url().includes(COMPANY_PROFILE_PATH) && r.request().method() === "POST"),
        page.getByRole("button", { name: "Save company profile" }).click(),
      ]);
      await expect(page.getByText("Company profile saved.")).toBeVisible();

      await expect.poll(() => isBeforeUnloadGuarded(page)).toBe(false);
    });

    test("post-save edit/revert: editing after a successful save is dirty again; reverting to the newly-saved value is clean again", async ({
      page,
      context,
      baseURL,
    }) => {
      await installBeforeUnloadObserver(page);
      await injectTestSession(context, fixtures.owner, baseURL!);
      await page.goto(COMPANY_PROFILE_PATH);

      const field = page.getByLabel("Legal company name");
      await field.fill("Newly Saved Baseline");
      await Promise.all([
        page.waitForResponse((r) => r.url().includes(COMPANY_PROFILE_PATH) && r.request().method() === "POST"),
        page.getByRole("button", { name: "Save company profile" }).click(),
      ]);
      await expect(page.getByText("Company profile saved.")).toBeVisible();
      await expect.poll(() => isBeforeUnloadGuarded(page)).toBe(false);

      // The clean anchor moved from the original persisted value to the
      // just-saved one -- reverting to the ORIGINAL value now, not the
      // new one, must leave it dirty.
      await field.fill("Acme Legal Name LLC");
      await expect.poll(() => isBeforeUnloadGuarded(page)).toBe(true);

      await field.fill("Newly Saved Baseline");
      await expect.poll(() => isBeforeUnloadGuarded(page)).toBe(false);
    });

    test("repeated successful saves: each save independently establishes its own new clean baseline, even though the success message is identical every time", async ({
      page,
      context,
      baseURL,
    }) => {
      await installBeforeUnloadObserver(page);
      await injectTestSession(context, fixtures.owner, baseURL!);
      await page.goto(COMPANY_PROFILE_PATH);

      const field = page.getByLabel("Legal company name");

      for (const name of ["First Save", "Second Save", "Third Save"]) {
        await field.fill(name);
        await expect.poll(() => isBeforeUnloadGuarded(page)).toBe(true);

        await Promise.all([
          page.waitForResponse((r) => r.url().includes(COMPANY_PROFILE_PATH) && r.request().method() === "POST"),
          page.getByRole("button", { name: "Save company profile" }).click(),
        ]);
        await expect(page.getByText("Company profile saved.")).toBeVisible();
        await expect.poll(() => isBeforeUnloadGuarded(page)).toBe(false);
      }

      const persisted = await dbQuery<{ legalName: string } | null>("organizationProfile", "findUnique", {
        where: { organizationId: fixtures.orgA.id },
        select: { legalName: true },
      });
      expect(persisted?.legalName).toBe("Third Save");
    });

    test("CurrencySelect and the native Timezone select participate in dirty/revert-to-clean the same as a plain field", async ({
      page,
      context,
      baseURL,
    }) => {
      await installBeforeUnloadObserver(page);
      await injectTestSession(context, fixtures.owner, baseURL!);
      await page.goto(COMPANY_PROFILE_PATH);
      await expect.poll(() => isBeforeUnloadGuarded(page)).toBe(false);

      await selectCurrencyOption(page, "Currency", "EUR");
      await expect.poll(() => isBeforeUnloadGuarded(page)).toBe(true);

      await selectCurrencyOption(page, "Currency", "USD");
      await expect.poll(() => isBeforeUnloadGuarded(page)).toBe(false);

      await page.getByLabel("Time zone").selectOption("Asia/Bangkok");
      await expect.poll(() => isBeforeUnloadGuarded(page)).toBe(true);

      await page.getByLabel("Time zone").selectOption("Asia/Singapore");
      await expect.poll(() => isBeforeUnloadGuarded(page)).toBe(false);
    });

    test("a successful logo upload alone does not make the unrelated CompanyProfileForm dirty", async ({
      page,
      context,
      baseURL,
    }) => {
      await installBeforeUnloadObserver(page);
      await injectTestSession(context, fixtures.owner, baseURL!);
      await page.goto(COMPANY_PROFILE_PATH);
      await expect.poll(() => isBeforeUnloadGuarded(page)).toBe(false);

      const LOGO_PNG_BYTES = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      );
      await page.getByLabel("Choose logo").setInputFiles({
        name: "e2e-logo.png",
        mimeType: "image/png",
        buffer: LOGO_PNG_BYTES,
      });
      await Promise.all([
        page.waitForResponse((r) => r.url().includes(COMPANY_PROFILE_PATH) && r.request().method() === "POST"),
        page.getByRole("button", { name: "Upload logo" }).click(),
      ]);
      await expect(page.getByRole("button", { name: "Replace logo" })).toBeVisible();

      // The profile form was never touched -- it must still read clean.
      await expect.poll(() => isBeforeUnloadGuarded(page)).toBe(false);
    });
  });
});
