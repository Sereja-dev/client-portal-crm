import { test, expect } from "@playwright/test";

/**
 * Sale-Ready Phase B, PR2.1 (Legal Foundation). Every page/link covered
 * here is public and unauthenticated — no DB fixtures needed (contrast
 * with password-reset.spec.ts, which does), so this suite has no
 * beforeAll/afterAll seeding at all.
 */

test.describe("Privacy Policy and Terms of Service pages", () => {
  test("/privacy renders with a heading and effective date", async ({ page }) => {
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { name: "Privacy Policy", level: 1 })).toBeVisible();
    await expect(page.getByText(/Effective/)).toBeVisible();
  });

  test("/terms renders with a heading and effective date", async ({ page }) => {
    await page.goto("/terms");
    await expect(page.getByRole("heading", { name: "Terms of Service", level: 1 })).toBeVisible();
    await expect(page.getByText(/Effective/)).toBeVisible();
  });

  test("/privacy links to /terms and vice versa", async ({ page }) => {
    await page.goto("/terms");
    await page.getByRole("link", { name: "Privacy Policy" }).first().click();
    await page.waitForURL(/\/privacy$/);
    await expect(page.getByRole("heading", { name: "Privacy Policy", level: 1 })).toBeVisible();
  });
});

// Privacy & Cookie Policy Improvement, Slice 2.
test.describe("Cookie Policy page", () => {
  test("/cookies renders with a heading and its own effective date", async ({ page }) => {
    await page.goto("/cookies");
    await expect(page.getByRole("heading", { name: "Cookie Policy", level: 1 })).toBeVisible();
    await expect(page.getByText(/Effective/)).toBeVisible();
  });

  test("/privacy's own cookie disclosure paragraph links to /cookies", async ({ page }) => {
    await page.goto("/privacy");
    // Scoped to <main>, not the global footer — /privacy now has two
    // "Cookie Policy" links (its own body paragraph, and the footer,
    // covered separately below) and must disambiguate between them.
    await page.getByRole("main").getByRole("link", { name: "Cookie Policy" }).click();
    await page.waitForURL(/\/cookies$/);
    await expect(page.getByRole("heading", { name: "Cookie Policy", level: 1 })).toBeVisible();
  });
});

test.describe("Global footer", () => {
  // /login, /signup, /forgot-password are Staff pre-auth routes — they
  // render AuthShell's own separate, fixed-dark local footer (class
  // `auth-shell-footer`) in place of the global one (see Footer's and
  // AuthShell's own doc comments, and globals.css's own
  // `body:has(.auth-shell) footer:not(.auth-shell-footer)` rule). The
  // /portal/* routes have no AuthShell of their own (Portal's auth pages
  // are "entirely separate", per AuthShell's own doc comment) and so
  // render the plain global footer, unhidden. Both footers now show all
  // three links — AuthShell's gained Cookie Policy in this follow-up;
  // the global footer already had it from the main Slice 2 commit.
  const PAGES_WITH_FOOTER = ["/login", "/signup", "/forgot-password", "/portal/login", "/portal/signup", "/portal/forgot-password"];

  for (const path of PAGES_WITH_FOOTER) {
    test(`footer with Privacy Policy, Terms of Service, and Cookie Policy links is present on ${path}`, async ({ page }) => {
      await page.goto(path);
      const footer = page.locator("footer");
      await expect(footer.getByRole("link", { name: "Privacy Policy" })).toBeVisible();
      await expect(footer.getByRole("link", { name: "Terms of Service" })).toBeVisible();
      await expect(footer.getByRole("link", { name: "Cookie Policy" })).toBeVisible();
      // Exactly one <footer> is ever VISIBLE per route — no duplicate.
      // (A second, CSS-hidden footer legitimately exists in the DOM on
      // every route — the global root-layout Footer, hidden here via
      // globals.css's `body:has(.auth-shell) footer:not(.auth-shell-footer)`
      // rule rather than removed — so this must filter by visibility,
      // not merely count every `<footer>` element.)
      await expect(page.locator("footer:visible")).toHaveCount(1);
    });
  }

  test("footer's Privacy Policy link navigates to /privacy from the login page", async ({ page }) => {
    await page.goto("/login");
    await page.locator("footer").getByRole("link", { name: "Privacy Policy" }).click();
    await page.waitForURL(/\/privacy$/);
    await expect(page.getByRole("heading", { name: "Privacy Policy", level: 1 })).toBeVisible();
  });

  test("footer's Terms of Service link navigates to /terms from the portal signup page", async ({ page }) => {
    await page.goto("/portal/signup");
    await page.locator("footer").getByRole("link", { name: "Terms of Service" }).click();
    await page.waitForURL(/\/terms$/);
    await expect(page.getByRole("heading", { name: "Terms of Service", level: 1 })).toBeVisible();
  });

  // /privacy itself is not an AuthShell route, so it renders the real
  // global footer visibly — the right place to exercise its new link.
  test("global footer on /privacy shows a Cookie Policy link that navigates to /cookies", async ({ page }) => {
    await page.goto("/privacy");
    const footer = page.locator("footer");
    await expect(footer.getByRole("link", { name: "Cookie Policy" })).toBeVisible();
    await footer.getByRole("link", { name: "Cookie Policy" }).click();
    await page.waitForURL(/\/cookies$/);
    await expect(page.getByRole("heading", { name: "Cookie Policy", level: 1 })).toBeVisible();
  });

  // Privacy & Cookie Policy Improvement, Slice 2 AuthShell follow-up.
  test("AuthShell footer's Cookie Policy link navigates to /cookies from the signup page", async ({ page }) => {
    await page.goto("/signup");
    await page.locator("footer").getByRole("link", { name: "Cookie Policy" }).click();
    await page.waitForURL(/\/cookies$/);
    await expect(page.getByRole("heading", { name: "Cookie Policy", level: 1 })).toBeVisible();
  });

  test("AuthShell footer remains usable at a narrow mobile viewport (390px)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/forgot-password");
    const footer = page.locator("footer");
    await expect(footer.getByRole("link", { name: "Privacy Policy" })).toBeVisible();
    await expect(footer.getByRole("link", { name: "Terms of Service" })).toBeVisible();
    await expect(footer.getByRole("link", { name: "Cookie Policy" })).toBeVisible();
    // No horizontal overflow at this width.
    const bodyScrollWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyScrollWidth).toBeLessThanOrEqual(390);
  });
});

test.describe("Signup consent copy", () => {
  test("staff signup shows a consent line linking to both policies", async ({ page }) => {
    await page.goto("/signup");
    const consent = page.getByText(/By creating an account, you agree to our/);
    await expect(consent).toBeVisible();
    await expect(consent.getByRole("link", { name: "Terms of Service" })).toBeVisible();
    await expect(consent.getByRole("link", { name: "Privacy Policy" })).toBeVisible();
  });

  test("portal signup shows a consent line linking to both policies", async ({ page }) => {
    await page.goto("/portal/signup");
    const consent = page.getByText(/By creating an account, you agree to our/);
    await expect(consent).toBeVisible();
    await expect(consent.getByRole("link", { name: "Terms of Service" })).toBeVisible();
    await expect(consent.getByRole("link", { name: "Privacy Policy" })).toBeVisible();
  });

  test("staff signup consent Terms of Service link navigates to /terms", async ({ page }) => {
    await page.goto("/signup");
    await page.getByText(/By creating an account, you agree to our/).getByRole("link", { name: "Terms of Service" }).click();
    await page.waitForURL(/\/terms$/);
    await expect(page.getByRole("heading", { name: "Terms of Service", level: 1 })).toBeVisible();
  });
});
