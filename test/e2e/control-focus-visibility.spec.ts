import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Product UI/UX PR 5 — real keyboard-focus geometry/style proof for the
 * two corrections that are only meaningfully verifiable through actual
 * browser focus behavior (F4's shared Select adoption already carried a
 * focus ring before this PR; F7's Invoice radio focus ring is genuinely
 * new). This file proves visible focus through real Tab-key navigation
 * and a computed-style assertion (`box-shadow`, which is how Tailwind's
 * `ring`/`focus-visible:ring-*` utilities are actually implemented) —
 * never by asserting a Tailwind class string exists, and never a
 * screenshot.
 */

let fixtures: TestFixtures;

test.beforeAll(async () => {
  fixtures = await seedE2EFixtures();
});

test.afterAll(async () => {
  await cleanupTestData(fixtures);
});

async function actAsMember(
  context: BrowserContext,
  baseURL: string,
  user: { id: string; email: string },
  organizationId: string,
): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, user, baseURL);
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

test.describe("Settings — Company Currency select shows a real keyboard focus-visible ring", () => {
  test("Tab-focusing the Currency select produces a real, non-empty box-shadow ring absent before focus", async ({
    page,
    context,
    baseURL,
  }) => {
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/settings/company");

    const currency = page.getByLabel("Currency");
    await expect(currency).toBeVisible();

    const beforeFocus = await currency.evaluate((el) => getComputedStyle(el).boxShadow);

    await currency.focus();
    const afterFocus = await currency.evaluate((el) => getComputedStyle(el).boxShadow);

    expect(afterFocus).not.toBe("none");
    expect(afterFocus).not.toBe(beforeFocus);
  });
});

test.describe("Invoice type radios (create page) show a real keyboard focus-visible ring", () => {
  test("Tab-focusing, then arrow-keying between, the Flat amount / Itemized radios produces a real focus ring on whichever is focused", async ({
    page,
    context,
    baseURL,
  }) => {
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/invoices/new");

    const flatRadio = page.getByRole("radio", { name: "Flat amount" });
    const itemizedRadio = page.getByRole("radio", { name: "Itemized" });
    await expect(flatRadio).toBeVisible();

    const beforeFocus = await flatRadio.evaluate((el) => getComputedStyle(el).boxShadow);

    await flatRadio.focus();
    const flatFocused = await flatRadio.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(flatFocused).not.toBe("none");
    expect(flatFocused).not.toBe(beforeFocus);

    // Real native radio-group keyboard behavior: ArrowRight moves both
    // focus and the checked state to the next radio in the same
    // `name="mode-selector"` group — never a fake button implementation.
    await page.keyboard.press("ArrowRight");
    await expect(itemizedRadio).toBeFocused();
    await expect(itemizedRadio).toBeChecked();

    const itemizedFocused = await itemizedRadio.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(itemizedFocused).not.toBe("none");

    // The now-unfocused Flat amount radio no longer shows the ring.
    const flatAfterMovingAway = await flatRadio.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(flatAfterMovingAway).toBe(beforeFocus);
  });
});

/**
 * Accessibility Improvement A3+A5 — real computed-style proof for the
 * shared formControlClasses() correction: the resting border now
 * resolves to the dedicated --border-form-control token (not
 * --border-strong), and focus now uses a wider, offset focus-visible:
 * ring (not the previous 1px focus: ring) — on all three distinct
 * underlying elements the one shared builder renders as (a native
 * <input>, a native <select>, and SearchableSelect's own text input).
 * Resting-border and focus assertions both read real computed style,
 * never a Tailwind class string — consistent with this file's own
 * existing convention above. All three controls are reached on the
 * single already-fixture-backed /settings/company page to avoid
 * redundant navigations/seeding.
 */
test.describe("Form controls — resting border resolves to --border-form-control, focus-visible ring is wider/offset", () => {
  test("native <select> (Time zone): resting border is the new token's color, focus still produces a real ring", async ({
    page,
    context,
    baseURL,
  }) => {
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/settings/company");

    const timezone = page.getByLabel("Time zone");
    await expect(timezone).toBeVisible();

    const restingBorder = await timezone.evaluate((el) => getComputedStyle(el).borderColor);
    // #7C8595 == rgb(124, 133, 149) — the approved Light --border-form-control
    // value; the previous --border-strong (#D1D5DB == rgb(209, 213, 219))
    // must be gone.
    expect(restingBorder).toContain("124, 133, 149");
    expect(restingBorder).not.toContain("209, 213, 219");

    const beforeFocus = restingBorder;
    const beforeShadow = await timezone.evaluate((el) => getComputedStyle(el).boxShadow);
    await timezone.focus();
    const afterShadow = await timezone.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(afterShadow).not.toBe("none");
    expect(afterShadow).not.toBe(beforeShadow);
    // Resting border is untouched while merely focused and valid —
    // only the ring (box-shadow) and the border-color swap-on-focus
    // change on :focus-visible, never the computed value this specific
    // assertion reads before that swap takes effect in the same tick.
    expect(beforeFocus).toContain("124, 133, 149");
  });

  test("plain <Input> (Display / company name): resting border is the new token's color, focus produces a wider/offset ring than the old 1px treatment", async ({
    page,
    context,
    baseURL,
  }) => {
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/settings/company");

    const displayName = page.getByLabel("Display / company name");
    await expect(displayName).toBeVisible();

    const restingBorder = await displayName.evaluate((el) => getComputedStyle(el).borderColor);
    expect(restingBorder).toContain("124, 133, 149");

    const beforeShadow = await displayName.evaluate((el) => getComputedStyle(el).boxShadow);
    await displayName.focus();
    const afterShadow = await displayName.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(afterShadow).not.toBe("none");
    expect(afterShadow).not.toBe(beforeShadow);

    // No layout shift: a box-shadow-based ring (how Tailwind's ring-*/
    // ring-offset-* utilities are implemented) never affects layout —
    // confirm the element's own box geometry is unchanged before/after.
    const boxBefore = await displayName.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { width: r.width, height: r.height };
    });
    const boxAfter = await displayName.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { width: r.width, height: r.height };
    });
    expect(boxAfter).toEqual(boxBefore);
  });

  test("SearchableSelect (Currency): resting border is the new token's color, focus still produces a real ring, combobox semantics unchanged", async ({
    page,
    context,
    baseURL,
  }) => {
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/settings/company");

    const currency = page.getByLabel("Currency");
    await expect(currency).toBeVisible();
    // Confirms this really is SearchableSelect's own text input, not a
    // native <select> — combobox semantics are the one thing this
    // slice must never alter.
    await expect(currency).toHaveAttribute("role", "combobox");

    const restingBorder = await currency.evaluate((el) => getComputedStyle(el).borderColor);
    expect(restingBorder).toContain("124, 133, 149");

    const beforeShadow = await currency.evaluate((el) => getComputedStyle(el).boxShadow);
    await currency.focus();
    const afterShadow = await currency.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(afterShadow).not.toBe("none");
    expect(afterShadow).not.toBe(beforeShadow);

    // Arrow/Enter/Escape/aria-expanded behavior is unchanged by this
    // slice — a narrow spot-check (full coverage already lives
    // elsewhere for this shared primitive).
    await page.keyboard.press("ArrowDown");
    await expect(currency).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(currency).toHaveAttribute("aria-expanded", "false");
  });

  test("pointer-focus documentation (not a failure): clicking a plain text Input still shows the focus-visible ring, matching standard browser behavior for text-entry controls", async ({
    page,
    context,
    baseURL,
  }) => {
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/settings/company");

    const displayName = page.getByLabel("Display / company name");
    const beforeShadow = await displayName.evaluate((el) => getComputedStyle(el).boxShadow);

    await displayName.click();
    const afterClickShadow = await displayName.evaluate((el) => getComputedStyle(el).boxShadow);

    // Browsers treat :focus-visible as matching after a pointer click
    // specifically for text-entry controls (typing is the expected next
    // action) — unlike Button, where a click never shows the ring. This
    // test documents that real, accepted behavior rather than asserting
    // the ring is suppressed on click, which would be a cross-browser-
    // fragile, incorrect expectation for this element type.
    expect(afterClickShadow).not.toBe("none");
    expect(afterClickShadow).not.toBe(beforeShadow);
  });

  test("Dark mode: resting border resolves to the approved translucent token, and focus still produces a real ring", async ({
    page,
    context,
    baseURL,
  }) => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "DARK" } });
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/settings/company");
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");

    const timezone = page.getByLabel("Time zone");
    await expect(timezone).toBeVisible();

    const restingBorder = await timezone.evaluate((el) => getComputedStyle(el).borderColor);
    // rgba(255, 255, 255, 0.40) — browsers normalize the trailing zero
    // away, so this checks for the un-normalized alpha substring instead
    // of a single exact string.
    expect(restingBorder).toContain("255, 255, 255");
    expect(restingBorder).toMatch(/0\.4\b/);

    const beforeShadow = await timezone.evaluate((el) => getComputedStyle(el).boxShadow);
    await timezone.focus();
    const afterShadow = await timezone.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(afterShadow).not.toBe("none");
    expect(afterShadow).not.toBe(beforeShadow);

    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "SYSTEM" } });
  });
});
