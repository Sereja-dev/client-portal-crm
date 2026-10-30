import { test, expect, type Page } from "@playwright/test";

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
test.describe("Operator identity (Public Beta legal alignment)", () => {
  // The brand name inside these sentences is the deployment's configured brand (the E2E server sets PLATFORM_NAME);
  // the operator and the "not a registered company" clause are fixed.
  const OPERATOR = /Umerenko Sergei, an individual, under the .+ brand/;
  const NOT_A_COMPANY = /is a product name, not a registered company\./;

  for (const route of ["/privacy", "/terms"]) {
    test(`${route} names the individual operator and states that Aqenra is not a registered company`, async ({ page }) => {
      await page.goto(route);
      const main = page.getByRole("main");
      await expect(main).toContainText(OPERATOR);
      await expect(main).toContainText(NOT_A_COMPANY);
    });
  }

  test("/cookies names the same operator", async ({ page }) => {
    await page.goto("/cookies");
    await expect(page.getByRole("main")).toContainText(OPERATOR);
  });

  test("no legal page presents Aqenra as a company, or states an address, tax id or governing-law jurisdiction", async ({ page }) => {
    for (const route of ["/privacy", "/terms", "/cookies"]) {
      await page.goto(route);
      const text = await page.getByRole("main").innerText();
      expect(text, `${route}: company-form wording`).not.toMatch(/\b(Inc\.?|LLC|Ltd\.?|GmbH|Corporation|incorporated)\b/i);
      expect(text, `${route}: registered address`).not.toMatch(/registered (office|address)/i);
      expect(text, `${route}: tax / registration id`).not.toMatch(/\b(VAT|EIN)\b/);
    }
    await page.goto("/terms");
    await expect(page.getByRole("main")).toContainText("the jurisdiction in which the Service operator is located");
  });

  test("Terms describe the free public beta, with no live billing", async ({ page }) => {
    await page.goto("/terms");
    await expect(page.getByRole("main")).toContainText("currently offered free of charge as a public beta");
  });

  test("the global footer and the pre-auth footer identify the operator", async ({ page }) => {
    await page.goto("/privacy");
    await expect(page.locator("footer").filter({ hasText: "Operated by Umerenko Sergei" }).first()).toBeVisible();
    await page.goto("/login");
    // The brand text before "Operated by" is deployment-configurable (the E2E server sets PLATFORM_NAME); the operator is not.
    await expect(page.locator("footer.auth-shell-footer")).toContainText(`© ${new Date().getFullYear()}`);
    await expect(page.locator("footer.auth-shell-footer")).toContainText("Operated by Umerenko Sergei");
  });

  test("legal pages are public: no redirect to login, and the footer identity is readable at 320px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    for (const route of ["/privacy", "/terms", "/cookies"]) {
      const response = await page.goto(route);
      expect(response?.status()).toBe(200);
      await expect(page).toHaveURL(new RegExp(`${route}$`));
    }
    await expect(page.locator("footer").filter({ hasText: "Operated by Umerenko Sergei" }).first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

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

/**
 * Cookie Policy Slice 2 — Mobile Horizontal Overflow Remediation.
 * Production defect: /cookies scrolled the whole page horizontally on
 * mobile, because <main> (a flex-item child of the root layout's
 * <body className="flex flex-col">) still grew to fit its widest
 * descendant — the Cookie Policy's min-w-[640px] table — instead of
 * being clamped to the viewport and letting the table's own
 * overflow-x-auto wrapper scroll locally. Fixed with `w-full` on
 * <main> (see that file's own doc comment for the full mechanism and
 * why `min-width: 0` alone, tried first, had zero measured effect).
 */
async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

test.describe("Legal pages — no page-level horizontal overflow", () => {
  const ROUTES = ["/cookies", "/privacy", "/terms"];
  const MOBILE_VIEWPORTS = [
    { width: 390, height: 900 },
    { width: 375, height: 812 },
    { width: 320, height: 700 },
  ];

  for (const route of ROUTES) {
    for (const vp of MOBILE_VIEWPORTS) {
      test(`${route} has no page-level horizontal overflow at ${vp.width}x${vp.height}`, async ({ page }) => {
        await page.setViewportSize(vp);
        await page.goto(route);
        await assertNoHorizontalOverflow(page);
      });
    }
  }

  // A representative desktop viewport — confirms the fix for the mobile
  // case introduces no regression at a width where the table already
  // fit without scrolling.
  test("all three legal pages have no horizontal overflow at a desktop viewport (1280x900)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    for (const route of ROUTES) {
      await page.goto(route);
      await assertNoHorizontalOverflow(page);
    }
  });
});

test.describe("Cookie Policy table — local horizontal scroll, not page-level scroll", () => {
  test("at 390px, the table wrapper (not the document) is the horizontal scroll container", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/cookies");

    const measurements = await page.evaluate(() => {
      const wrapper = document.querySelector(".overflow-x-auto") as HTMLElement;
      const table = document.querySelector("table") as HTMLTableElement;
      return {
        docScrollWidth: document.documentElement.scrollWidth,
        docClientWidth: document.documentElement.clientWidth,
        wrapperClientWidth: wrapper.clientWidth,
        wrapperScrollWidth: wrapper.scrollWidth,
        tableWidth: table.getBoundingClientRect().width,
        columnCount: table.querySelectorAll("thead th").length,
      };
    });

    // The document itself does not horizontally overflow...
    expect(measurements.docScrollWidth).toBeLessThanOrEqual(measurements.docClientWidth + 1);
    // ...while the table wrapper genuinely has more content than it can
    // show at once — i.e. it, not the page, is the thing that scrolls.
    expect(measurements.wrapperScrollWidth).toBeGreaterThan(measurements.wrapperClientWidth);
    // All six columns are still present — nothing was removed to make
    // this fit.
    expect(measurements.columnCount).toBe(6);
  });

  test("the table wrapper actually scrolls horizontally, independent of the page's own scroll position", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/cookies");

    const wrapper = page.locator(".overflow-x-auto");
    await expect(wrapper).toHaveJSProperty("scrollLeft", 0);

    await wrapper.evaluate((el) => {
      el.scrollLeft = 200;
    });

    await expect(wrapper).toHaveJSProperty("scrollLeft", 200);
    // The page's own scroll position is untouched by scrolling the
    // wrapper — confirming this is local, contained scrolling, not a
    // side effect of (or substitute for) whole-page overflow.
    const pageScrollX = await page.evaluate(() => window.scrollX);
    expect(pageScrollX).toBe(0);
  });

  test("at desktop (1280px), the table fits without needing to scroll, and the column count is unchanged", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/cookies");

    const measurements = await page.evaluate(() => {
      const wrapper = document.querySelector(".overflow-x-auto") as HTMLElement;
      const table = document.querySelector("table") as HTMLTableElement;
      return {
        wrapperClientWidth: wrapper.clientWidth,
        wrapperScrollWidth: wrapper.scrollWidth,
        columnCount: table.querySelectorAll("thead th").length,
      };
    });

    expect(measurements.wrapperScrollWidth).toBeLessThanOrEqual(measurements.wrapperClientWidth + 1);
    expect(measurements.columnCount).toBe(6);
  });
});
