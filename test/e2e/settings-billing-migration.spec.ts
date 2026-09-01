import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Design System page migration Batch 8 — Settings Billing. Covers this
 * batch's own critical gates: real Dark computed-style checks for the
 * migrated card surfaces, the current-plan accent highlight, the usage
 * bar's status-driven fill color, and the notice-banner tone map — plus
 * mobile no-overflow. Every business-facing behavior (checkout/manage
 * redirect wiring, plan-state derivation, usage math, over-limit
 * detection) is already exhaustively covered by test/e2e/billing-ui.spec.ts
 * and test/e2e/billing-mock-flow.spec.ts — deliberately not repeated here.
 */

let fixtures: TestFixtures;

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

async function setSubscription(organizationId: string, overrides: Record<string, unknown> = {}) {
  await dbQuery("subscription", "deleteMany", { where: { organizationId } });
  const now = new Date().toISOString();
  await dbQuery("subscription", "create", {
    data: {
      organizationId,
      planKey: "STARTER",
      status: "ACTIVE",
      trialStartedAt: now,
      trialEndsAt: now,
      ...overrides,
    },
  });
}

test.describe("Design System Batch 8 — Settings Billing", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test.beforeEach(async ({ context, baseURL }) => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "DARK" } });
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await setSubscription(fixtures.orgA.id, { planKey: "STARTER", status: "ACTIVE" });
  });

  test.afterEach(async () => {
    await dbQuery("subscription", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
  });

  test("Dark: current-plan and usage cards are opaque, no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("/settings/billing");
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");

    const currentPlanSection = page.locator('section[aria-labelledby="billing-current-plan-heading"]');
    await expect(currentPlanSection).toBeVisible();
    await expect
      .poll(() => currentPlanSection.evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe("rgb(27, 31, 38)");

    const usageSection = page.locator('section[aria-labelledby="billing-usage-heading"]');
    await expect
      .poll(() => usageSection.evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe("rgb(27, 31, 38)");

    expect(errors).toEqual([]);
  });

  test("Dark: the current plan card shows the accent border/badge; a non-current plan card shows the default border", async ({
    page,
  }) => {
    await page.goto("/settings/billing");
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");

    // "Current plan" is also the (disabled) CTA label on the current
    // plan's own PlanActionButton — scoped to the <span> badge
    // specifically, the only element of that tag with this text.
    const currentBadge = page.locator("span").filter({ hasText: "Current plan" });
    await expect(currentBadge).toBeVisible();
    // Dark's --accent is rgb(108, 101, 201) — never the old literal
    // bg-gray-900/border-gray-900.
    await expect
      .poll(() => currentBadge.evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe("rgb(108, 101, 201)");

    const plansSection = page.locator('section[aria-labelledby="billing-plans-heading"]');
    const allCards = plansSection.locator("div.rounded-lg");
    const cardCount = await allCards.count();
    test.skip(cardCount < 2, "Fixture plan catalog does not yield 2+ plan cards");

    const currentCard = allCards.filter({ hasText: "Current plan" }).first();
    await expect
      .poll(() => currentCard.evaluate((el) => getComputedStyle(el).borderColor))
      .toBe("rgb(108, 101, 201)");

    const otherCard = allCards.filter({ hasNotText: "Current plan" }).first();
    const otherBorder = await otherCard.evaluate((el) => getComputedStyle(el).borderColor);
    expect(otherBorder).not.toBe("rgb(108, 101, 201)");
  });

  test("Dark: usage bar fill reflects status — NORMAL is accent, EXCEEDED is danger", async ({ page }) => {
    await page.goto("/settings/billing");
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");

    // Scoped to the "Clients" row specifically — the fixture org's own
    // staff headcount (owner+admin+member) already exceeds STARTER's
    // maxMembers=1, so the Members row is never a reliable NORMAL baseline;
    // Clients starts well under STARTER's maxClients=10 before this test's
    // own mutation below.
    // Scoped inside the Usage section specifically — the Sidebar's own
    // "Clients" nav link also exact-matches "Clients" page-wide. From the
    // row's own label text node, exactly two levels up reaches UsageRow's
    // own root <div> (label span -> its flex wrapper -> the row root),
    // the narrowest ancestor containing exactly this one row's progressbar.
    const usageSectionForRows = page.locator('section[aria-labelledby="billing-usage-heading"]');
    const clientsRow = usageSectionForRows.getByText("Clients", { exact: true }).locator("../..");
    const clientsFill = clientsRow.locator('[role="progressbar"] > div');
    await expect
      .poll(() => clientsFill.evaluate((el) => getComputedStyle(el).backgroundColor))
      // Dark's --accent (rgb(108, 101, 201)) for NORMAL usage.
      .toBe("rgb(108, 101, 201)");

    // Push Clients past the STARTER limit to reach EXCEEDED.
    const extraClients = Array.from({ length: 10 }, (_, i) => ({
      name: `BATCH8-E2E-OverLimit-${i}-${fixtures.runId}`,
      userId: fixtures.owner.id,
      organizationId: fixtures.orgA.id,
    }));
    await dbQuery("client", "createMany", { data: extraClients });
    try {
      await page.reload();
      // The fixture org's Members row is already over STARTER's
      // maxMembers=1 (see the NORMAL-baseline comment above), so it shows
      // its own "Over limit" tag too — scoped to the Clients row
      // specifically, not a page-wide match.
      const exceededClientsRow = usageSectionForRows.getByText("Clients", { exact: true }).locator("../..");
      const overLimitTag = exceededClientsRow.getByText("Over limit", { exact: true });
      await expect(overLimitTag).toBeVisible();
      // Dark's --danger is rgb(232, 117, 106).
      await expect.poll(() => overLimitTag.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(232, 117, 106)");

      const exceededFill = exceededClientsRow.locator('[role="progressbar"] > div');
      await expect
        .poll(() => exceededFill.evaluate((el) => getComputedStyle(el).backgroundColor))
        .toBe("rgb(232, 117, 106)");
    } finally {
      await dbQuery("client", "deleteMany", { where: { name: { startsWith: "BATCH8-E2E-OverLimit-" } } });
    }
  });

  test("Dark: checkout=success and checkout=cancel notices render with distinct, readable tones", async ({ page }) => {
    await page.goto("/settings/billing?checkout=success");
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");
    const successNotice = page.getByText("Payment received", { exact: false });
    await expect(successNotice).toBeVisible();
    // Dark's --info is rgb(111, 168, 232).
    await expect.poll(() => successNotice.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(111, 168, 232)");

    await page.goto("/settings/billing?checkout=cancel");
    const cancelNotice = page.getByText("Checkout was canceled", { exact: false });
    await expect(cancelNotice).toBeVisible();
    // Neutral tone uses text-text-secondary, not the old raw gray-700.
    await expect.poll(() => cancelNotice.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(160, 166, 176)");
  });

  test("Action-wiring invariant: the non-owner disabled Manage subscription control stays inert and correctly labeled", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAsMember(context, baseURL!, fixtures.admin, fixtures.orgA.id);
    await page.goto("/settings/billing");
    // Scoped to the Current Plan section specifically — the same
    // "Only the organization owner..." copy also appears as a disabled
    // PlanCard's own disabledReason further down the page.
    const currentPlanSection = page.locator('section[aria-labelledby="billing-current-plan-heading"]');
    const button = currentPlanSection.getByRole("button", { name: "Manage subscription" });
    await expect(button).toBeDisabled();
    await expect(currentPlanSection.getByText("Only the organization owner can manage billing.")).toBeVisible();
  });

  test("Mobile (390/320px): Billing page fits viewport with no horizontal overflow", async ({ page }) => {
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/settings/billing");
      await expect(page.getByRole("heading", { name: "Billing", level: 1 })).toBeVisible();
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    }
  });
});
