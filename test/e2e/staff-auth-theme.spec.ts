import { test, expect, type BrowserContext, type Page } from "@playwright/test";

/**
 * Pre-Auth Redesign, Slice A — replaces Accessibility Improvement A4's
 * own theme-AWARENESS proof with the new, opposite contract Product
 * explicitly chose: Staff pre-auth is now a FIXED dark shell,
 * independent of the authenticated app's own Light/Dark/System
 * preference. The three states proven below (no cookie, an explicit
 * Light cookie, an explicit Dark cookie) all resolve to the identical
 * fixed-dark values — the point being that the cookie's own value no
 * longer matters for this shell at all, while `<html data-theme>`
 * itself still resolves exactly as before (proving the authenticated
 * app's own theme system is genuinely untouched, not merely "also
 * happens to look dark right now").
 *
 * Entirely unauthenticated (both routes are pre-login by definition).
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

function shellCard(page: Page) {
  return page.locator(".auth-shell main > div > div").first();
}

function shellBrandText(page: Page) {
  return page.locator(".auth-shell header").getByText("Aqenra", { exact: true });
}

test.describe("Staff pre-auth — fixed dark, independent of the authenticated-app theme cookie", () => {
  for (const [label, cookieValue] of [
    ["no cookie at all (a genuinely fresh visitor)", null],
    ["an explicit Light cookie", "light.light"],
    ["an explicit Dark cookie", "dark.dark"],
  ] as const) {
    test(`/login — ${label}: shell/card/brand-text/heading all resolve to the fixed dark values`, async ({
      page,
      context,
      baseURL,
    }) => {
      if (cookieValue) {
        await setThemeCookie(context, baseURL!, cookieValue);
      }
      await page.goto("/login");

      // The authenticated app's own theme system is genuinely untouched:
      // `<html data-theme>` still resolves exactly as the cookie says
      // (or the generic Light SSR default with no cookie) — it is the
      // auth shell's OWN rendered colors that stay fixed, not the
      // document-level attribute this shell deliberately ignores.
      const expectedHtmlTheme = cookieValue === "dark.dark" ? "dark" : "light";
      await expect.poll(() => resolvedAttr(page)).toBe(expectedHtmlTheme);

      const shellBg = await page.locator(".auth-shell").first().evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(shellBg).toContain("14, 16, 20"); // --background (fixed) #0E1014

      const cardBg = await shellCard(page).evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(cardBg).toContain("27, 31, 38"); // --surface (fixed) #1B1F26
      expect(cardBg).not.toContain("255, 255, 255"); // never the old Light white, regardless of html theme

      const brandColor = await shellBrandText(page).evaluate((el) => getComputedStyle(el).color);
      expect(brandColor).toContain("236, 237, 238"); // --text-primary (fixed) #ECEDEE

      const heading = page.getByRole("heading", { name: "Sign in" });
      const headingColor = await heading.evaluate((el) => getComputedStyle(el).color);
      expect(headingColor).toContain("236, 237, 238");
    });
  }

  test("/signup (Dark cookie): shell/card fixed-dark; the muted legal disclaimer resolves to the fixed --text-muted value", async ({
    page,
    context,
    baseURL,
  }) => {
    await setThemeCookie(context, baseURL!, "dark.dark");
    await page.goto("/signup");

    const cardBg = await shellCard(page).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(cardBg).toContain("27, 31, 38");

    const disclaimer = page.getByText("By creating an account, you agree to our");
    const disclaimerColor = await disclaimer.evaluate((el) => getComputedStyle(el).color);
    expect(disclaimerColor).toContain("134, 140, 151"); // --text-muted (fixed) #868C97
  });

  test("/signup (Light cookie): still fixed-dark — the one case A4's own original test suite could never have covered, since Light used to mean Light here", async ({
    page,
    context,
    baseURL,
  }) => {
    await setThemeCookie(context, baseURL!, "light.light");
    await page.goto("/signup");
    await expect.poll(() => resolvedAttr(page)).toBe("light"); // html theme itself is still genuinely Light

    const cardBg = await shellCard(page).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(cardBg).toContain("27, 31, 38"); // yet the shell/card is still the fixed dark value
  });
});

// Scoped to the shell's own <header> — Login/Signup's own secondary
// cross-link text ("Don't have an account? Create account" / "Already
// have an account? Sign in") now deliberately matches the top-right
// action's own label too (Slice A's own content-model normalization),
// so an unscoped role query is ambiguous by design, not a bug.
function shellHeaderAction(page: Page) {
  return page.locator(".auth-shell header").getByRole("link");
}

test.describe("Staff pre-auth — brand mark and top-right contextual action", () => {
  test("/login: the brand mark links home, and 'Create account' is the top-right action", async ({ page }) => {
    await page.goto("/login");
    const brandLink = page.locator(".auth-shell header a").first();
    await expect(brandLink).toHaveAttribute("href", "/");
    await expect(brandLink.locator("svg")).toHaveAttribute("aria-hidden", "true");

    const topRight = shellHeaderAction(page).filter({ hasText: "Create account" });
    await expect(topRight).toBeVisible();
    // Carries the same default redirectTo=/dashboard every existing
    // secondary cross-link on this page already appends (sanitizeRedirectPath's
    // own fallback, not new behavior this slice introduced) — a plain
    // visit with no ?redirectTo= still produces a truthy default.
    await expect(topRight).toHaveAttribute("href", /^\/signup/);
  });

  test("/signup: top-right action is 'Sign in' -> /login", async ({ page }) => {
    await page.goto("/signup");
    await expect(shellHeaderAction(page).filter({ hasText: "Sign in" })).toHaveAttribute("href", /^\/login/);
  });

  test("/forgot-password and /reset-password: top-right action is 'Back to sign in' -> /login", async ({ page }) => {
    await page.goto("/forgot-password");
    await expect(page.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/login");

    await page.goto("/reset-password");
    await expect(page.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/login");
  });

  test("/: top-right action is 'Sign in' -> /login, and the primary CTA is 'Create account' -> /signup", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Sign in" }).first()).toHaveAttribute("href", "/login");
    await expect(page.getByRole("link", { name: "Create account" })).toHaveAttribute("href", "/signup");
  });

  test("/organization-unavailable: top-right 'Sign in' is the only interactive element, no form/mutation control exists", async ({
    page,
  }) => {
    await page.goto("/organization-unavailable");
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    await expect(page.getByRole("heading", { name: "Workspace unavailable" })).toBeVisible();
    await expect(page.locator("form")).toHaveCount(0);
  });
});

test.describe("Staff pre-auth — route-specific content model (headings, normalized copy)", () => {
  test("forgot-password heading reads 'Reset your password'", async ({ page }) => {
    await page.goto("/forgot-password");
    await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
  });

  test("login's secondary cross-link reads 'Create account', not 'Sign up'", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Don't have an account?")).toBeVisible();
    await expect(page.getByRole("link", { name: "Create account" })).toHaveCount(2); // top-right + secondary link
  });

  test("signup's primary CTA reads 'Create account'", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
  });
});

test.describe("Staff Auth link focus — semantic focus ring", () => {
  test("Tab-focusing 'Forgot password?' produces a real ring matching the fixed --focus-ring value", async ({ page }) => {
    await page.goto("/login");
    const link = page.getByRole("link", { name: "Forgot password?" });

    const before = await link.evaluate((el) => getComputedStyle(el).boxShadow);
    await link.focus();
    const after = await link.evaluate((el) => getComputedStyle(el).boxShadow);

    expect(after).not.toBe("none");
    expect(after).not.toBe(before);
    expect(after).toContain("155, 150, 232"); // --focus-ring (fixed) #9B96E8 — visible on a near-black surface

    await link.click();
    await expect(page).toHaveURL(/\/forgot-password/);
  });
});

test.describe("Portal regression — entirely untouched by the Staff pre-auth redesign", () => {
  test("/portal/login still resolves to its own, separate, theme-reactive colors — never the Staff fixed-dark values", async ({
    page,
  }) => {
    await page.goto("/portal/login");
    await expect.poll(() => resolvedAttr(page)).toBe("light"); // default SSR, unaffected

    const main = page.locator("main").first();
    const mainBg = await main.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(mainBg).toContain("245, 245, 247"); // --surface-recessed Light — Portal still theme-reactive, not fixed dark
    expect(mainBg).not.toContain("14, 16, 20"); // never the Staff shell's fixed --background

    // Portal's own shell never gained the Staff-only `.auth-shell` class.
    await expect(page.locator(".auth-shell")).toHaveCount(0);
  });

  test("/portal/forgot-password and /portal/reset-password: the shared form components render unchanged — no Staff brand/top-right chrome leaked in", async ({
    page,
  }) => {
    await page.goto("/portal/forgot-password");
    await expect(page.locator(".auth-shell")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Create account" })).toHaveCount(0);

    await page.goto("/portal/reset-password");
    await expect(page.locator(".auth-shell")).toHaveCount(0);
  });
});
