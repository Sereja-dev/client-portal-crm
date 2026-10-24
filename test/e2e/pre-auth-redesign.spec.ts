import { test, expect, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Pre-Auth Redesign, Slice A — responsive/no-overflow coverage across
 * every migrated route, plus the newly-migrated-surface behavior
 * staff-auth-theme.spec.ts doesn't already own (the invite page's own
 * authenticated-vs-unauthenticated top-right truthfulness, and the
 * legal footer actually being reachable/correct on the new dark shell).
 */

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

const ROUTES = ["/", "/login", "/signup", "/forgot-password", "/reset-password", "/organization-unavailable"];

test.describe("Pre-auth redesign — responsive, no horizontal overflow", () => {
  for (const width of [390, 768, 1280, 1920]) {
    test(`${width}px: every migrated route renders with no page-level horizontal overflow`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const route of ROUTES) {
        await page.goto(route);
        await assertNoHorizontalOverflow(page);
      }
    });
  }

  test("390px: header brand mark, wordmark, and top-right action all remain visible and reachable, never overlapping", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/login");

    const brand = page.locator(".auth-shell header a").first();
    await expect(brand).toBeVisible();
    // Scoped to the header — login-form.tsx's own secondary cross-link
    // now deliberately shares the same "Create account" label.
    const topRight = page.locator(".auth-shell header").getByRole("link", { name: "Create account" });
    await expect(topRight).toBeVisible();

    const brandBox = (await brand.boundingBox())!;
    const actionBox = (await topRight.boundingBox())!;
    // No horizontal overlap between the two header regions at the
    // narrowest supported width.
    expect(brandBox.x + brandBox.width).toBeLessThanOrEqual(actionBox.x + 1);
  });

  test("390px: AuthShell's own local Privacy/Terms links remain visible under the dark card (the global Footer hides itself here; this is the one footer that actually renders on this route)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/login");
    await expect(page.getByRole("link", { name: "Privacy Policy" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Terms of Service" })).toBeVisible();
  });

  test("long validation error text wraps instead of forcing overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/login");
    await page.getByRole("textbox", { name: "Email" }).fill("not-an-email");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill("x");
    await page.getByRole("button", { name: "Sign in" }).click();
    await assertNoHorizontalOverflow(page);
  });
});

test.describe("Pre-auth redesign — invite page truthful top-right action", () => {
  let fixtures: TestFixtures;

  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test("unauthenticated viewer sees a 'Sign in' top-right action on the invite page", async ({ page }) => {
    await page.goto(`/invite/${fixtures.invitation.token}`);
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });

  test("an already-authenticated viewer (any state) never sees a false 'Sign in' action", async ({
    page,
    context,
    baseURL,
  }) => {
    await injectTestSession(context, fixtures.owner, baseURL!);
    // fixtures.owner's own email never matches fixtures.invitation's target
    // email, so this exercises the "signed in as the wrong identity"
    // branch — still, truthfully, no "Sign in" action belongs here.
    await page.goto(`/invite/${fixtures.invitation.token}`);
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sign out and log in with the right account" })).toBeVisible();
  });
});

// (auth)/error.tsx — no safe way to force a real render-time throw from
// E2E without destabilizing a real auth page; its migration onto
// AuthShell (and that it still exposes no error.message/digest) is
// proven instead by the source-contract checks in
// test/unit/staff-auth-theme-tokens.test.ts.
