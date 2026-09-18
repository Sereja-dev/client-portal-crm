import { test, expect } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

// Regression coverage for the app-wide tablet-breakpoint horizontal
// overflow (issue #20). Root cause: the (dashboard) layout's flex-1
// column (Header + main, sibling of the now-fixed-width Sidebar at the
// md breakpoint) had no min-w-0, so it never shrank below its content's
// intrinsic width — the exact same default `min-width: auto` flex trap
// header.tsx's own mobile-overflow fix (PR #19) already fixed for the
// header's own internal row. Covers every width named in the ticket,
// both the wide-tablet breakpoints that regressed and the narrow mobile
// breakpoints PR #19 already fixed, so a future change can't reintroduce
// either.
const WIDTHS = [320, 375, 390, 430, 768, 800, 834, 1024];

async function assertNoHorizontalOverflow(page: import("@playwright/test").Page, path: string) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(path);
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, `${path} at ${width}px: scrollWidth (${scrollWidth}) should not exceed clientWidth (${clientWidth})`).toBeLessThanOrEqual(clientWidth);
  }
}

let fixtures: TestFixtures;

test.beforeAll(async () => {
  fixtures = await seedE2EFixtures();
});

test.afterAll(async () => {
  await cleanupTestData(fixtures);
});

test.describe("staff dashboard routes", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await injectTestSession(context, { id: fixtures.owner.id, email: fixtures.owner.email }, baseURL!);
  });

  for (const path of ["/dashboard", "/clients", "/projects", "/tasks", "/invoices", "/team", "/team/permissions", "/settings/notifications", "/settings/billing", "/settings/integrations", "/analytics"]) {
    test(`no horizontal overflow on ${path}`, async ({ page }) => {
      await assertNoHorizontalOverflow(page, path);
    });
  }

  test("desktop layout unchanged at 1280px", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/dashboard");
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  });

  test("organization switcher remains usable at the tablet breakpoint", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto("/dashboard");
    // fixtures.owner belongs to a single organization, so the switcher
    // renders as the plain (non-dropdown) name/slug block — see
    // organization-switcher.tsx's own `organizations.length === 1` branch.
    await expect(page.getByText(/Test Org A/)).toBeVisible();
  });

  test("sign out remains reachable at the tablet breakpoint", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });
});

// Staff-app main content max-width (first approved design/polish item).
// (dashboard)/layout.tsx's <main> now wraps its children in a centered,
// max-w-7xl inner container — see that file's own comment. Deliberately
// its own describe block, separate from the tablet-focused WIDTHS sweep
// above (issue #20): that sweep never reaches a width wide enough for
// this cap to matter in the first place, and asserting real
// browser-computed layout (bounding boxes) here is more direct than
// asserting against the Tailwind class string that produces it.
const WIDE_WIDTHS = [1280, 1440, 1920];

test.describe("staff main content max-width (design polish)", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await injectTestSession(context, { id: fixtures.owner.id, email: fixtures.owner.email }, baseURL!);
  });

  for (const path of ["/dashboard", "/clients", "/invoices"]) {
    test(`no horizontal overflow on ${path} at wide desktop widths`, async ({ page }) => {
      for (const width of WIDE_WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(path);
        const { scrollWidth, clientWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(scrollWidth, `${path} at ${width}px: scrollWidth (${scrollWidth}) should not exceed clientWidth (${clientWidth})`).toBeLessThanOrEqual(clientWidth);
      }
    });
  }

  test("main content is capped well below the full available width and centered at 1920px", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto("/dashboard");

    const main = page.locator("main");
    const content = main.locator(":scope > *").first();
    const mainBox = await main.boundingBox();
    const contentBox = await content.boundingBox();
    if (!mainBox || !contentBox) {
      throw new Error("expected main/content bounding boxes to be measurable");
    }

    // If content simply filled main's available width, it would only be
    // ~48px narrower than main (the existing p-6 padding). A genuine cap
    // leaves hundreds of pixels of margin at a 1920px-wide viewport.
    expect(contentBox.width).toBeLessThan(mainBox.width - 200);

    // Centered within main: left and right margins are approximately equal.
    const leftGap = contentBox.x - mainBox.x;
    const rightGap = mainBox.x + mainBox.width - (contentBox.x + contentBox.width);
    expect(Math.abs(leftGap - rightGap)).toBeLessThan(4);
  });

  test("main content width stops growing once the viewport exceeds the cap", async ({ page }) => {
    async function contentWidthAt(width: number): Promise<number> {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/dashboard");
      const box = await page.locator("main").locator(":scope > *").first().boundingBox();
      if (!box) {
        throw new Error("expected content bounding box to be measurable");
      }
      return box.width;
    }

    // Both widths are comfortably past the point the cap takes effect
    // (main's own available content width already exceeds max-w-7xl at
    // both) — a bounded container stays flat here; an unbounded one would
    // keep growing in step with the viewport.
    const widthAt1920 = await contentWidthAt(1920);
    const widthAt2200 = await contentWidthAt(2200);
    expect(Math.abs(widthAt2200 - widthAt1920)).toBeLessThan(10);
  });
});

test.describe("client portal route", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await injectTestSession(context, { id: fixtures.portalUser.id, email: fixtures.portalUser.email }, baseURL!);
  });

  test("no horizontal overflow on /portal", async ({ page }) => {
    await assertNoHorizontalOverflow(page, "/portal");
  });
});
