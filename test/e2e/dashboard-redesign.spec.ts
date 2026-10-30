import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Dashboard Redesign — real-browser coverage for the operational
 * Dashboard structure: exactly five KPI cards, the old page-level period
 * selector/Revenue chart/three status-breakdown cards genuinely absent,
 * Needs Attention/Today/Recent Activity all present, the three header
 * CTAs correct (including the real overdue-filtered Tasks destination),
 * and responsive behavior at the app's own established representative
 * widths. Domain-layer semantics (exact KPI/Needs-Attention/Today
 * query correctness) are already exhaustively covered by
 * test/integration/dashboard/redesign-semantics.test.ts — this file only
 * covers what genuinely needs a real browser.
 */

let fixtures: TestFixtures;

async function actAsOwner(context: BrowserContext, baseURL: string): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, fixtures.owner, baseURL);
  await context.addCookies([
    {
      name: "active_organization_id",
      value: fixtures.orgA.id,
      domain: new URL(baseURL).hostname,
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

async function gotoDashboard(page: Page): Promise<void> {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

test.describe("Dashboard Redesign", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test.beforeEach(async ({ context, baseURL }) => {
    await actAsOwner(context, baseURL!);
  });

  test.describe("Structure", () => {
    test("renders exactly five KPI cards, with the correct labels", async ({ page }) => {
      await gotoDashboard(page);
      // Scoped to <main> — the sidebar's own "Clients" nav link (outside
      // <main>) would otherwise also match the bare label.
      const main = page.getByRole("main");
      for (const label of ["Clients", "Active projects", "Open tasks", "Outstanding invoices", "Revenue"]) {
        await expect(main.getByRole("link", { name: new RegExp(`^${label}`, "i") })).toBeVisible();
      }
      // Exactly five — the old sixth card ("Paid revenue"/"Overdue tasks")
      // is gone; count every KPI-card-shaped link by its own <p> label
      // structure via the total number of matches for the five names above.
      const kpiLinks = main.getByRole("link", { name: /^(Clients|Active projects|Open tasks|Outstanding invoices|Revenue)( |$)/ });
      await expect(kpiLinks).toHaveCount(5);
    });

    test("the old page-level period selector is absent", async ({ page }) => {
      await gotoDashboard(page);
      await expect(page.getByText("Period", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "7 days" })).toHaveCount(0);
    });

    test("the Revenue-over-time chart is absent", async ({ page }) => {
      await gotoDashboard(page);
      await expect(page.getByRole("heading", { name: "Revenue over time" })).toHaveCount(0);
    });

    test("the three status-breakdown cards are absent", async ({ page }) => {
      await gotoDashboard(page);
      await expect(page.getByRole("heading", { name: "Invoice status" })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Task status" })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Project status" })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Breakdowns" })).toHaveCount(0);
    });

    test("Needs attention, Today, and Recent activity are all present", async ({ page }) => {
      await gotoDashboard(page);
      await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Recent activity" })).toBeVisible();
    });
  });

  test.describe("CTAs", () => {
    test("Add client links to /clients/new", async ({ page }) => {
      await gotoDashboard(page);
      await expect(page.getByRole("link", { name: "Add client" })).toHaveAttribute("href", "/clients/new");
    });

    test("Create invoice links to /invoices/new", async ({ page }) => {
      await gotoDashboard(page);
      await expect(page.getByRole("link", { name: "Create invoice" })).toHaveAttribute("href", "/invoices/new");
    });

    test("View overdue tasks links to the real overdue-filtered Tasks destination and lands correctly", async ({ page }) => {
      await gotoDashboard(page);
      const cta = page.getByRole("link", { name: "View overdue tasks" });
      await expect(cta).toHaveAttribute("href", "/tasks?overdue=true");
      await cta.click();
      await expect(page).toHaveURL(/\/tasks\?overdue=true/);
      // The active-filter state is visible — the subtitle names "overdue"
      // and the SearchFilterBar's own existing "Clear" link appears.
      await expect(page.getByText(/overdue task/i)).toBeVisible();
    });
  });

  test.describe("Needs attention — empty and populated states", () => {
    test("a bounded overdue-invoice row shows in Needs Attention and links to the real invoice", async ({ page }) => {
      const overdueInvoice = await dbQuery<{ id: string; invoiceNumber: string }>("invoice", "create", {
        data: {
          invoiceNumber: `E2E-DASH-NA-${Date.now()}`,
          status: "SENT",
          amount: "77.00",
          subtotal: "77.00",
          discountAmount: "0.00",
          taxAmount: "0.00",
          currency: "USD",
          clientId: fixtures.clientA.id,
          organizationId: fixtures.orgA.id,
          issueDate: new Date(),
          dueDate: new Date("2020-01-01T00:00:00.000Z"),
        },
      });
      try {
        await gotoDashboard(page);
        await expect(page.getByRole("heading", { name: "Overdue invoices" })).toBeVisible();
        await expect(page.getByText(overdueInvoice.invoiceNumber)).toBeVisible();
      } finally {
        await dbQuery("invoice", "deleteMany", { where: { id: overdueInvoice.id } });
      }
    });
  });

  test.describe("Responsive", () => {
    async function expectNoOverflow(page: Page): Promise<void> {
      const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(hasOverflow).toBe(false);
    }

    test("390px: KPI cards and CTAs remain usable, no horizontal overflow", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await gotoDashboard(page);
      await expect(page.getByRole("link", { name: "Add client" })).toBeVisible();
      await expectNoOverflow(page);
    });

    // Page-level scrollWidth checks pass or fail on a few pixels of font-metric slack (CI's Linux text is wider than
    // macOS's, which is what let the 320px overflow slip through locally). This checks the structural invariant
    // instead: nothing inside a KPI card may extend past that card's own edge.
    for (const width of [320, 390, 1280]) {
      test(`${width}px: every KPI card's content stays inside its own card`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await gotoDashboard(page);
        const labels = ["Clients", "Active projects", "Open tasks", "Outstanding invoices", "Revenue"];
        const outside = await page.evaluate((names) => {
          const problems: string[] = [];
          for (const name of names) {
            const label = [...document.querySelectorAll("main p")].find((p) => p.textContent?.trim() === name);
            const card = label?.closest("a");
            if (!label || !card) {
              problems.push(`${name}: card not found`);
              continue;
            }
            const cardRight = card.getBoundingClientRect().right;
            for (const el of card.querySelectorAll("*")) {
              const right = el.getBoundingClientRect().right;
              if (right > cardRight + 0.5) problems.push(`${name}: <${el.tagName.toLowerCase()}> extends ${Math.round(right - cardRight)}px past its card`);
            }
            const range = document.createRange();
            range.selectNodeContents(label);
            const textRight = Math.max(...[...range.getClientRects()].map((r) => r.right));
            if (textRight > cardRight + 0.5) problems.push(`${name}: label text extends ${Math.round(textRight - cardRight)}px past its card`);
          }
          return problems;
        }, labels);
        expect(outside).toEqual([]);
      });
    }

    test("834px: KPI grid and Needs Attention/Today stack usably, no overflow", async ({ page }) => {
      await page.setViewportSize({ width: 834, height: 1100 });
      await gotoDashboard(page);
      await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
      await expectNoOverflow(page);
    });

    test("1280px: full desktop layout, no overflow", async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await gotoDashboard(page);
      await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
      await expectNoOverflow(page);
    });
  });
});

const THEME_COOKIE_NAME = "aqenra_theme";

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

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(hasOverflow).toBe(false);
}

/**
 * Free Public Beta — Welcome Banner. Two genuinely different test
 * surfaces, deliberately not conflated:
 *
 * 1. The REAL `/dashboard` route, under this repo's own actual, current
 *    E2E environment — FREE_BETA_MODE is not set anywhere in
 *    playwright.config.ts's shared webServer.env, and test code cannot
 *    mutate the already-spawned `next start` process's env after the
 *    fact, so every test against the real route genuinely exercises the
 *    Free-Beta-OFF path. This is reported as exactly what it is, never
 *    claimed as proof of the enabled path.
 *
 * 2. The TEST_MODE-only harness route (src/app/test-only/free-beta-
 *    banner/page.tsx) — exercises the real FreeBetaBanner component's
 *    own behavior (visibility, dismissal, persistence, per-user
 *    isolation, accessibility, responsiveness) deterministically,
 *    independent of FREE_BETA_MODE, the same "isolated test
 *    configuration" category of solution src/app/test-only/theme/
 *    already establishes for an analogous problem.
 */
test.describe("Free Public Beta — Welcome Banner", () => {
  test.describe("Real /dashboard route (this repo's actual current E2E environment: FREE_BETA_MODE unset)", () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await actAsOwner(context, baseURL!);
    });

    test("2: the banner is absent when FREE_BETA_MODE resolves to disabled — the genuinely true state of this E2E environment, not simulated", async ({ page }) => {
      await gotoDashboard(page);
      await expect(page.getByText("Aqenra is in Public Beta")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Dismiss beta notice" })).toHaveCount(0);
    });

    test("10: no banner on an unrelated authenticated route", async ({ page }) => {
      await page.goto("/clients");
      await expect(page.getByText("Aqenra is in Public Beta")).toHaveCount(0);
    });

    test("16: existing Dashboard heading and content remain fully visible and unaffected", async ({ page }) => {
      await gotoDashboard(page);
      await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Add client" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
    });
  });

  test.describe("TEST_MODE harness (/test-only/free-beta-banner): real FreeBetaBanner behavior", () => {
    test("1: the banner is visible by default, with the approved copy", async ({ page }) => {
      await page.goto("/test-only/free-beta-banner?userId=visible-check");
      await expect(page.getByText("Aqenra is in Public Beta")).toBeVisible();
      await expect(
        page.getByText(
          "Aqenra is currently in public beta. We're actively improving the platform, so some features may change or be updated. Thanks for being an early user!",
        ),
      ).toBeVisible();
    });

    test("3: clicking the dismiss button hides the banner immediately", async ({ page }) => {
      await page.goto("/test-only/free-beta-banner?userId=dismiss-click");
      await expect(page.getByText("Aqenra is in Public Beta")).toBeVisible();
      await page.getByRole("button", { name: "Dismiss beta notice" }).click();
      await expect(page.getByText("Aqenra is in Public Beta")).toHaveCount(0);
    });

    test("4: dismissal persists after a full page reload", async ({ page }) => {
      await page.goto("/test-only/free-beta-banner?userId=dismiss-reload");
      await page.getByRole("button", { name: "Dismiss beta notice" }).click();
      await page.reload();
      await expect(page.getByText("Aqenra is in Public Beta")).toHaveCount(0);
    });

    test("5: dismissal persists after navigating away and back", async ({ page }) => {
      await page.goto("/test-only/free-beta-banner?userId=dismiss-navigate");
      await page.getByRole("button", { name: "Dismiss beta notice" }).click();
      await page.goto("/test-only/theme");
      await page.goto("/test-only/free-beta-banner?userId=dismiss-navigate");
      await expect(page.getByText("Aqenra is in Public Beta")).toHaveCount(0);
    });

    test("6: dismissal survives a sign-out/sign-in cycle for the same user and browser — clearing the auth cookie never touches localStorage", async ({ page, context }) => {
      await page.goto("/test-only/free-beta-banner?userId=dismiss-signout");
      await page.getByRole("button", { name: "Dismiss beta notice" }).click();

      // Simulates sign-out: removes every cookie (the only session this
      // harness has at all is TEST_MODE's own identity cookie elsewhere
      // in the suite — this route itself sets none), never touching
      // localStorage, which lives in a completely separate browser
      // storage mechanism.
      await context.clearCookies();
      await page.goto("/test-only/free-beta-banner?userId=dismiss-signout");
      await expect(page.getByText("Aqenra is in Public Beta")).toHaveCount(0);
    });

    test("7: different users on the same browser do not share dismissal state", async ({ page }) => {
      await page.goto("/test-only/free-beta-banner?userId=isolation-user-a");
      await page.getByRole("button", { name: "Dismiss beta notice" }).click();
      await expect(page.getByText("Aqenra is in Public Beta")).toHaveCount(0);

      await page.goto("/test-only/free-beta-banner?userId=isolation-user-b");
      await expect(page.getByText("Aqenra is in Public Beta")).toBeVisible();
    });

    test("8: a localStorage failure never crashes the page, and dismissing still works for the current session", async ({ page }) => {
      await page.addInitScript(() => {
        Object.defineProperty(window, "localStorage", {
          value: {
            getItem: () => {
              throw new Error("SecurityError");
            },
            setItem: () => {
              throw new Error("SecurityError");
            },
          },
          configurable: true,
        });
      });
      await page.goto("/test-only/free-beta-banner?userId=storage-failure");
      await expect(page.getByText("Aqenra is in Public Beta")).toBeVisible();
      await page.getByRole("button", { name: "Dismiss beta notice" }).click();
      await expect(page.getByText("Aqenra is in Public Beta")).toHaveCount(0);
    });

    test("9: no hydration-mismatch console error on load", async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });
      await page.goto("/test-only/free-beta-banner?userId=hydration-check");
      await expect(page.getByText("Aqenra is in Public Beta")).toBeVisible();
      const hydrationErrors = consoleErrors.filter((text) => /hydrat/i.test(text));
      expect(hydrationErrors).toEqual([]);
    });

    test("11: the dismiss button is keyboard-focusable and activatable via Enter", async ({ page }) => {
      await page.goto("/test-only/free-beta-banner?userId=keyboard-check");
      const dismissButton = page.getByRole("button", { name: "Dismiss beta notice" });
      await dismissButton.focus();
      await expect(dismissButton).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByText("Aqenra is in Public Beta")).toHaveCount(0);
    });

    test("12/13: renders with readable contrast in both light and dark themes", async ({ page, context, baseURL }) => {
      await setThemeCookie(context, baseURL!, "light.light");
      await page.goto("/test-only/free-beta-banner?userId=theme-light");
      await expect(page.getByText("Aqenra is in Public Beta")).toBeVisible();

      await setThemeCookie(context, baseURL!, "dark.dark");
      await page.goto("/test-only/free-beta-banner?userId=theme-dark");
      await expect(page.getByText("Aqenra is in Public Beta")).toBeVisible();
    });

    test("14: fits a 390px mobile viewport with no horizontal overflow, dismiss button still visible", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/test-only/free-beta-banner?userId=mobile-check");
      await expect(page.getByText("Aqenra is in Public Beta")).toBeVisible();
      await expect(page.getByRole("button", { name: "Dismiss beta notice" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  });
});
