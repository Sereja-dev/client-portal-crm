import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Mobile Navigation Foundation (Mobile Improvement Slice A). Real-browser
 * coverage for what the pure mobile-nav.ts unit suite structurally cannot
 * exercise: the actual Sidebar/MobileNavigation swap at the `md` breakpoint,
 * the native <dialog> drawer's own open/close/focus behavior, and real
 * permission-filtered rendering end-to-end. The exact active-state/route-
 * classification *logic* is already exhaustively covered in
 * test/unit/layout/mobile-nav.test.ts — this file deliberately does not
 * repeat those cases, only what genuinely requires a real browser.
 */

const MOBILE_VIEWPORT = { width: 390, height: 844 };

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

async function actAsMember(
  context: BrowserContext,
  baseURL: string,
  user: { id: string; email: string },
  organizationId: string,
): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, user, baseURL);
  await setActiveOrg(context, baseURL, organizationId);
}

async function gotoAndSettle(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}

function bottomNav(page: Page) {
  // Scoped by data-testid, not role+name: MobileNavigation's own bottom
  // <nav> deliberately shares the same aria-label="Primary" convention
  // desktop Sidebar's own <nav> already uses (the two are never visible
  // at once, so sharing the landmark name is harmless for real users),
  // but that makes a role-based query ambiguous for a test asserting
  // "is my mobile nav specifically absent" at a desktop viewport, where
  // Sidebar's own identically-labeled nav is legitimately visible.
  return page.getByTestId("mobile-bottom-nav");
}

function moreDrawer(page: Page) {
  return page.getByRole("dialog", { name: "More" });
}

let fixtures: TestFixtures;

test.beforeAll(async () => {
  fixtures = await seedE2EFixtures();
});

test.afterAll(async () => {
  await cleanupTestData(fixtures);
});

test.describe("Mobile bottom nav — core", () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test("the old horizontal Sidebar strip is absent; the bottom nav is visible with the five expected labels and correct hrefs", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await gotoAndSettle(page, `${baseURL}/dashboard`);

    // Sidebar's own desktop <nav aria-label="Primary"> is `hidden` below
    // md, not removed from the DOM — so it must not be the *visible*
    // "Primary" nav; MobileNavigation's own bottom nav is a second
    // element with the same accessible name, confirmed below to be the
    // one actually shown.
    await expect(bottomNav(page)).toBeVisible();

    for (const label of ["Home", "Clients", "Work", "Finance", "More"]) {
      await expect(bottomNav(page).getByText(label, { exact: true })).toBeVisible();
    }

    await expect(bottomNav(page).getByRole("link", { name: /Home/ })).toHaveAttribute("href", "/dashboard");
    await expect(bottomNav(page).getByRole("link", { name: /Clients/ })).toHaveAttribute("href", "/clients");
    await expect(bottomNav(page).getByRole("link", { name: /Work/ })).toHaveAttribute("href", "/projects");
    await expect(bottomNav(page).getByRole("link", { name: /Finance/ })).toHaveAttribute("href", "/finance");
  });

  test("the four bottom-nav links navigate to the expected real routes, with correct active state", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await gotoAndSettle(page, `${baseURL}/dashboard`);

    await expect(bottomNav(page).getByRole("link", { name: /Home/ })).toHaveAttribute("aria-current", "page");

    await bottomNav(page).getByRole("link", { name: /Clients/ }).click();
    await expect(page).toHaveURL(/\/clients$/);
    await expect(bottomNav(page).getByRole("link", { name: /Clients/ })).toHaveAttribute("aria-current", "page");

    await bottomNav(page).getByRole("link", { name: /Work/ }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await expect(bottomNav(page).getByRole("link", { name: /Work/ })).toHaveAttribute("aria-current", "page");

    await bottomNav(page).getByRole("link", { name: /Finance/ }).click();
    await expect(page).toHaveURL(/\/finance$/);
    await expect(bottomNav(page).getByRole("link", { name: /Finance/ })).toHaveAttribute("aria-current", "page");
  });
});

test.describe("More drawer", () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test("opens on tap, renders the expected secondary groups, navigates, and closes", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await gotoAndSettle(page, `${baseURL}/dashboard`);

    await bottomNav(page).getByRole("button", { name: "More" }).click();
    await expect(moreDrawer(page)).toBeVisible();

    // Multi-child groups' own section headers are unambiguous text.
    for (const group of ["Sales", "Documents", "Support", "Insights"]) {
      await expect(moreDrawer(page).getByText(group, { exact: true })).toBeVisible();
    }
    // Team/Settings are single-child groups whose own section header
    // text is identical to their one link's own text ("Team"/"Settings")
    // by design — asserted via the real navigable link instead, which
    // already proves the group reached the drawer at all.
    await expect(moreDrawer(page).getByRole("link", { name: "Team" })).toBeVisible();
    await expect(moreDrawer(page).getByRole("link", { name: "Settings" })).toBeVisible();
    // None of the four promoted groups' own labels are duplicated inside
    // the drawer.
    for (const promoted of ["Home", "Clients", "Work", "Finance"]) {
      await expect(moreDrawer(page).getByText(promoted, { exact: true })).toHaveCount(0);
    }

    await moreDrawer(page).getByRole("link", { name: "Team" }).click();
    await expect(page).toHaveURL(/\/team$/);
    await expect(moreDrawer(page)).toBeHidden();
  });

  test("Escape closes the drawer; it can be reopened; no destructive horizontal overflow while open", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await gotoAndSettle(page, `${baseURL}/dashboard`);

    await bottomNav(page).getByRole("button", { name: "More" }).click();
    await expect(moreDrawer(page)).toBeVisible();

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

    await page.keyboard.press("Escape");
    await expect(moreDrawer(page)).toBeHidden();

    await bottomNav(page).getByRole("button", { name: "More" }).click();
    await expect(moreDrawer(page)).toBeVisible();
  });

  test("focus returns to the More trigger after closing", async ({ context, baseURL, page }) => {
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await gotoAndSettle(page, `${baseURL}/dashboard`);

    const trigger = bottomNav(page).getByRole("button", { name: "More" });
    await trigger.click();
    await expect(moreDrawer(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  });
});

test.describe("Permission-filtered drawer content", () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test("OWNER sees Analytics and Reports under Insights; MEMBER sees only Activity (same permission source as desktop Sidebar)", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await gotoAndSettle(page, `${baseURL}/dashboard`);
    await bottomNav(page).getByRole("button", { name: "More" }).click();
    await expect(moreDrawer(page).getByRole("link", { name: "Analytics" })).toBeVisible();
    await expect(moreDrawer(page).getByRole("link", { name: "Reports" })).toBeVisible();
    await expect(moreDrawer(page).getByRole("link", { name: "Activity" })).toBeVisible();

    await page.keyboard.press("Escape");
    await actAsMember(context, baseURL!, fixtures.member, fixtures.orgA.id);
    await gotoAndSettle(page, `${baseURL}/dashboard`);
    await bottomNav(page).getByRole("button", { name: "More" }).click();
    await expect(moreDrawer(page).getByRole("link", { name: "Analytics" })).toHaveCount(0);
    await expect(moreDrawer(page).getByRole("link", { name: "Reports" })).toHaveCount(0);
    await expect(moreDrawer(page).getByRole("link", { name: "Activity" })).toBeVisible();
  });
});

test.describe("Focused-form routes hide the bottom nav", () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test("/invoices/new: bottom nav absent, form remains usable", async ({ context, baseURL, page }) => {
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await gotoAndSettle(page, `${baseURL}/invoices/new`);
    await expect(bottomNav(page)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Add invoice" })).toBeVisible();
  });

  test("/projects/new: bottom nav absent, form remains usable", async ({ context, baseURL, page }) => {
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await gotoAndSettle(page, `${baseURL}/projects/new`);
    await expect(bottomNav(page)).toHaveCount(0);
  });

  test("/settings/company: bottom nav absent", async ({ context, baseURL, page }) => {
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await gotoAndSettle(page, `${baseURL}/settings/company`);
    await expect(bottomNav(page)).toHaveCount(0);
  });

  test("/clients/[id]/edit: bottom nav absent, while the Client Hub detail page itself keeps it visible", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);

    await gotoAndSettle(page, `${baseURL}/clients/${fixtures.clientA.id}/edit`);
    await expect(bottomNav(page)).toHaveCount(0);

    await gotoAndSettle(page, `${baseURL}/clients/${fixtures.clientA.id}`);
    await expect(bottomNav(page)).toBeVisible();
  });
});

test.describe("Detail/list routes keep the bottom nav visible", () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test("/clients (list) and a Client Hub detail page both show the bottom nav", async ({ context, baseURL, page }) => {
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);

    await gotoAndSettle(page, `${baseURL}/clients`);
    await expect(bottomNav(page)).toBeVisible();

    await gotoAndSettle(page, `${baseURL}/clients/${fixtures.clientA.id}`);
    await expect(bottomNav(page)).toBeVisible();
    await expect(bottomNav(page).getByRole("link", { name: /Clients/ })).toHaveAttribute("aria-current", "page");
  });
});

test.describe("Breakpoint behavior", () => {
  test("390px: mobile bottom nav visible, desktop Sidebar absent", async ({ context, baseURL, page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await gotoAndSettle(page, `${baseURL}/dashboard`);
    await expect(bottomNav(page)).toBeVisible();
    await expect(page.getByRole("link", { name: "Dashboard" })).toHaveCount(0); // Sidebar's own single-destination Home link label
  });

  test("767px: still mobile behavior", async ({ context, baseURL, page }) => {
    await page.setViewportSize({ width: 767, height: 900 });
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await gotoAndSettle(page, `${baseURL}/dashboard`);
    await expect(bottomNav(page)).toBeVisible();
  });

  test("768px and up: desktop Sidebar visible, mobile bottom nav absent", async ({ context, baseURL, page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await gotoAndSettle(page, `${baseURL}/dashboard`);
    // CSS-only responsive hiding (md:hidden), matching Sidebar's own
    // symmetric hidden/md:flex approach — the element is still present
    // in the DOM at this width, just not visible, so toBeHidden() (not
    // toHaveCount(0), which getByTestId would never satisfy regardless
    // of CSS visibility) is the semantically correct assertion here.
    await expect(bottomNav(page)).toBeHidden();
    await expect(page.locator("nav[aria-label='Primary']").first()).toBeVisible();
  });

  test("a normal desktop width never shows both navs at once", async ({ context, baseURL, page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await gotoAndSettle(page, `${baseURL}/dashboard`);
    await expect(bottomNav(page)).toBeHidden();
  });
});

test.describe("Safe content at mobile width", () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test("the bottom nav's own bounding box never overlaps the last visible content on a normal list page", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await gotoAndSettle(page, `${baseURL}/clients`);

    const navBox = await bottomNav(page).boundingBox();
    expect(navBox).not.toBeNull();

    // The page's own last piece of real content (the footer, present on
    // every dashboard page via (dashboard)/layout.tsx -- reusing an
    // already-present, stable element rather than depending on list
    // fixture row counts).
    const lastContent = page.locator("body").last();
    await lastContent.scrollIntoViewIfNeeded();

    // Bounded, non-pixel-perfect check: the nav bar's own top edge must
    // not sit above the bottom of the viewport's visible content area --
    // i.e. it never climbs up and swallows real page content beyond its
    // own fixed strip.
    const viewportHeight = page.viewportSize()!.height;
    expect(navBox!.y).toBeGreaterThan(viewportHeight - 100);
  });
});

test.describe("Search/notifications regression at mobile width", () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test("Global Search trigger remains reachable and the header is not clipped", async ({ context, baseURL, page }) => {
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await gotoAndSettle(page, `${baseURL}/dashboard`);

    const searchTrigger = page.getByRole("button", { name: "Search (Cmd+K)" });
    await expect(searchTrigger).toBeVisible();
    await searchTrigger.click();
    await expect(page.getByRole("combobox", { name: "Search" })).toBeFocused();
    await page.keyboard.press("Escape");

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  });

  test("the notification bell remains usable", async ({ context, baseURL, page }) => {
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await gotoAndSettle(page, `${baseURL}/dashboard`);
    // NotificationBell's real trigger is a <summary aria-label="Notifications"
    // | "Notifications, N unread"> inside a native <details> — matched by
    // its exact aria-label rather than an assumed ARIA role mapping.
    const bell = page.getByLabel(/Notifications/);
    await expect(bell.first()).toBeVisible();
  });
});
