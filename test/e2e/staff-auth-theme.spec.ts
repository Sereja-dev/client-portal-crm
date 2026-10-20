import { test, expect, type BrowserContext, type Page } from "@playwright/test";

/**
 * Accessibility Improvement A4 — real computed-style proof that Staff
 * /login and /signup are now theme-aware. Entirely unauthenticated (both
 * routes are pre-login by definition) — Dark is forced the same way a
 * real returning visitor would already have it: by setting the real
 * `aqenra_theme` cookie directly (same name/value-format
 * appearance-settings.spec.ts's own `cookieValue()`/`COOKIE_NAME`
 * already proves the app reads/writes — e.g. `"dark.dark"` for an
 * explicit Dark selection), never by forcing a DB `themeMode` (there is
 * no session yet to attach one to at this point in the flow — that is
 * exactly the scenario this slice's own audit confirmed the pre-paint
 * script already resolves correctly, purely from `document.cookie`,
 * with zero dependency on auth state).
 *
 * Never submits Login or Signup — no account is created, no session is
 * established. Computed-style assertions only, never a screenshot.
 */

const THEME_COOKIE_NAME = "aqenra_theme";

function resolvedAttr(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.getAttribute("data-theme"));
}

async function setThemeCookie(context: BrowserContext, baseURL: string, value: string): Promise<void> {
  await context.addCookies([
    {
      name: THEME_COOKIE_NAME,
      value,
      domain: new URL(baseURL).hostname,
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

test.describe("Staff Auth theme-awareness — /login", () => {
  test("Light (default, no persisted cookie): shell/card/border/brand-text resolve to the expected Light semantic values", async ({
    page,
  }) => {
    await page.goto("/login");
    await expect.poll(() => resolvedAttr(page)).toBe("light");

    const main = page.locator("main");
    const mainBg = await main.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(mainBg).toContain("245, 245, 247"); // --surface-recessed Light #F5F5F7

    const card = main.locator("> div").first();
    const cardBg = await card.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(cardBg).toContain("255, 255, 255"); // --surface (= var(--background)) Light #ffffff — same value bg-white already resolved to

    const cardBorder = await card.evaluate((el) => getComputedStyle(el).borderColor);
    expect(cardBorder).toContain("229, 231, 235"); // --border-default Light #E5E7EB — same hex border-gray-200 already was

    const brand = main.locator("> span").first();
    const brandColor = await brand.evaluate((el) => getComputedStyle(el).color);
    expect(brandColor).toContain("23, 23, 23"); // --text-primary Light #171717
  });

  test("Dark (real persisted theme cookie, fully unauthenticated): shell/card/brand-text resolve to Dark semantic values, no old literal Light color remains", async ({
    page,
    context,
    baseURL,
  }) => {
    await setThemeCookie(context, baseURL!, "dark.dark");
    await page.goto("/login");
    await expect.poll(() => resolvedAttr(page)).toBe("dark");

    const main = page.locator("main");
    const mainBg = await main.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(mainBg).toContain("20, 23, 28"); // --surface-recessed Dark #14171C
    expect(mainBg).not.toContain("249, 250, 251"); // the old literal bg-gray-50 (#F9FAFB) must never remain

    const card = main.locator("> div").first();
    const cardBg = await card.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(cardBg).toContain("27, 31, 38"); // --surface Dark #1B1F26
    expect(cardBg).not.toContain("255, 255, 255"); // the old literal bg-white must never remain

    const brand = main.locator("> span").first();
    const brandColor = await brand.evaluate((el) => getComputedStyle(el).color);
    expect(brandColor).toContain("236, 237, 238"); // --text-primary Dark #ECEDEE (var(--foreground))
  });
});

test.describe("Staff Auth theme-awareness — /signup (Dark representative)", () => {
  test("shell/card theme-aware; the muted Terms/Privacy disclaimer resolves to the Dark semantic --text-muted token", async ({
    page,
    context,
    baseURL,
  }) => {
    await setThemeCookie(context, baseURL!, "dark.dark");
    await page.goto("/signup");
    await expect.poll(() => resolvedAttr(page)).toBe("dark");

    const main = page.locator("main");
    const mainBg = await main.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(mainBg).toContain("20, 23, 28");

    const card = main.locator("> div").first();
    const cardBg = await card.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(cardBg).toContain("27, 31, 38");

    const disclaimer = page.getByText("By creating an account, you agree to our");
    const disclaimerColor = await disclaimer.evaluate((el) => getComputedStyle(el).color);
    expect(disclaimerColor).toContain("134, 140, 151"); // --text-muted Dark #868C97 (Accessibility Improvement A2)
  });
});

test.describe("Staff Auth link focus — semantic focus ring, not literal black", () => {
  test("Light: Tab-focusing 'Forgot password?' produces a real ring whose color matches --focus-ring (identical to the old literal black value)", async ({
    page,
  }) => {
    await page.goto("/login");
    const link = page.getByRole("link", { name: "Forgot password?" });

    const before = await link.evaluate((el) => getComputedStyle(el).boxShadow);
    await link.focus();
    const after = await link.evaluate((el) => getComputedStyle(el).boxShadow);

    expect(after).not.toBe("none");
    expect(after).not.toBe(before);
    expect(after).toContain("0, 0, 0"); // --focus-ring Light #000000 — the same resolved value focus-visible:ring-black already had
  });

  test("Dark: the same link's focus ring resolves to the semantic --focus-ring color, not an invisible/literal black", async ({
    page,
    context,
    baseURL,
  }) => {
    await setThemeCookie(context, baseURL!, "dark.dark");
    await page.goto("/login");
    await expect.poll(() => resolvedAttr(page)).toBe("dark");

    const link = page.getByRole("link", { name: "Forgot password?" });
    const before = await link.evaluate((el) => getComputedStyle(el).boxShadow);
    await link.focus();
    const after = await link.evaluate((el) => getComputedStyle(el).boxShadow);

    expect(after).not.toBe("none");
    expect(after).not.toBe(before);
    expect(after).toContain("155, 150, 232"); // --focus-ring Dark #9B96E8 — visible on a near-black surface, unlike literal black
  });

  test("the link still navigates normally", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await expect(page).toHaveURL(/\/forgot-password/);
  });
});
