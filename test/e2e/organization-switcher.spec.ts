import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Pre-push review of the Light hover-visibility broadening — the real
 * OrganizationSwitcher dropdown (only reachable by a genuinely
 * multi-org member; every fixture user from seedE2EFixtures() belongs
 * to exactly one org by design) was never opened during that review,
 * so the muted org-slug's contrast against the broadened --hover
 * background was a source-level inference, not a rendered one.
 * Reproduced here first (same membership-seeding technique
 * test/e2e/global-search.spec.ts already established for its own "real
 * org switch" test), then asserted against the real computed colors —
 * not implementation strings — so a future regression here fails on
 * what a user would actually see, not on a className match.
 */

async function setActiveOrg(context: BrowserContext, baseURL: string, organizationId: string): Promise<void> {
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

let fixtures: TestFixtures;

test.beforeAll(async () => {
  fixtures = await seedE2EFixtures();
  await dbQuery("membership", "create", {
    data: { userId: fixtures.owner.id, organizationId: fixtures.orgB.id, role: "MEMBER" },
  });
});

test.afterAll(async () => {
  await cleanupTestData(fixtures);
});

for (const themeMode of ["LIGHT", "DARK"] as const) {
  test(`org slug text stays readable through hover (${themeMode})`, async ({ page, context, baseURL }) => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode } });
    await injectTestSession(context, fixtures.owner, baseURL!);
    await setActiveOrg(context, baseURL!, fixtures.orgA.id);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    const switcherSummary = page.locator("header").locator("summary", { hasText: "Test Org A" });
    await expect(switcherSummary).toBeVisible();
    await switcherSummary.click();

    const items = page.locator("header").locator("button").filter({ hasText: "Test Org" });
    const currentItem = items.filter({ hasText: "Test Org A" }).first();
    const otherItem = items.filter({ hasText: "Test Org B" }).first();
    await expect(otherItem).toBeVisible();

    // The current org is checkmarked and distinguishable independent of
    // hover — not itself this task's concern, but a cheap regression
    // guard for "distinguishable" while already here.
    await expect(currentItem.locator('span[aria-hidden="true"].text-accent')).toBeVisible();

    const otherSlug = otherItem.locator("span.text-text-muted");
    const restingColor = await otherSlug.evaluate((el) => getComputedStyle(el).color);

    await otherItem.hover();
    await page.waitForTimeout(400);
    const hoveredBg = await otherItem.evaluate((el) => getComputedStyle(el).backgroundColor);
    const hoveredColor = await otherSlug.evaluate((el) => getComputedStyle(el).color);

    if (themeMode === "LIGHT") {
      // Hover must stay clearly visible (the whole point of the fix).
      expect(hoveredBg).toBe("rgb(212, 212, 212)");
      // The slug promotes to --muted-on-hover (--text-secondary,
      // #525252) instead of staying --text-muted (#737373) once
      // hovered — the actual contrast fix. Resting is untouched.
      expect(restingColor).toBe("rgb(115, 115, 115)");
      expect(hoveredColor).toBe("rgb(82, 82, 82)");
    } else {
      // Dark was never reported as an issue — both the hover
      // background and the slug color must be byte-identical whether
      // hovered or not.
      expect(hoveredBg).toBe("rgba(255, 255, 255, 0.06)");
      expect(hoveredColor).toBe(restingColor);
    }

    await page.mouse.move(0, 0);
  });
}
