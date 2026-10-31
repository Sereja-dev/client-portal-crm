import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Staff feedback widget — responsive overlap safety. At its default spot the
 * floating button must never sit on top of a control the user needs, on the
 * pages where that matters, at phone / tablet / desktop / short / landscape
 * sizes. The check is geometric but honest: a control only counts as covered
 * if, with the widget hidden, it is genuinely the visible element at the
 * overlapping point (so rows clipped inside a scroll area are not counted).
 *
 * The thing under test is the END of each page (last row, pagination "Next",
 * form Save/Cancel, bulk-action bar) — a fixed button necessarily passes over
 * content mid-scroll, which is why it is draggable. Before the in-flow
 * clearance, the pagination "Next" link was covered by 7px from 768px up.
 */

let fixtures: TestFixtures;

async function actAsOwner(context: BrowserContext, baseURL: string) {
  await context.clearCookies();
  await injectTestSession(context, fixtures.owner, baseURL);
  await context.addCookies([{ name: "active_organization_id", value: fixtures.orgA.id, domain: new URL(baseURL).hostname, path: "/", httpOnly: true, secure: false, sameSite: "Lax" }]);
}

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
  { width: 1280, height: 500 },
  { width: 844, height: 390 },
];
const LIST_PAGES = ["/dashboard", "/clients", "/leads", "/projects", "/invoices", "/contracts", "/tasks", "/requests"];
const FORM_PAGES = ["/clients/new", "/invoices/new", "/tasks/new", "/projects/new"];

async function coveredByWidget(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const widget = document.querySelector<HTMLElement>('button[aria-label^="Feedback"]');
    if (!widget) return ["(widget missing)"];
    const wr = widget.getBoundingClientRect();
    const covered: string[] = [];
    const selector = 'a[href],button,input,select,textarea,summary,[role="button"],[role="checkbox"]';
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      if (el === widget || widget.contains(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const ix = Math.min(wr.right, r.right) - Math.max(wr.left, r.left);
      const iy = Math.min(wr.bottom, r.bottom) - Math.max(wr.top, r.top);
      if (ix <= 2 || iy <= 2) continue;
      const previous = widget.style.visibility;
      widget.style.visibility = "hidden";
      const x = (Math.max(wr.left, r.left) + Math.min(wr.right, r.right)) / 2;
      const y = (Math.max(wr.top, r.top) + Math.min(wr.bottom, r.bottom)) / 2;
      const top = document.elementFromPoint(x, y);
      widget.style.visibility = previous;
      if (!top || !(top === el || el.contains(top))) continue;
      const label = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("name") || el.tagName).trim().replace(/\s+/g, " ").slice(0, 50);
      covered.push(`${el.tagName.toLowerCase()}[${label}] ${Math.round(ix)}x${Math.round(iy)}px`);
    }
    return covered;
  });
}

const scrollToEnd = (page: Page) => page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
const horizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe("Staff feedback widget — overlap safety", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
    // Enough rows to produce a second page of clients ("Next") and a populated, selectable contracts list.
    await dbQuery("client", "createMany", { data: Array.from({ length: 25 }, (_, i) => ({ name: `Layout Client ${i}`, organizationId: fixtures.orgA.id, userId: fixtures.owner.id })) });
    for (let i = 0; i < 12; i++) {
      await dbQuery("contract", "create", {
        data: { contractNumber: `LAY-${Date.now()}-${i}`, title: `Layout Contract ${i}`, body: "Body.", status: "DRAFT", issueDate: "2026-06-01T00:00:00.000Z", organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, createdByUserId: fixtures.owner.id },
      });
    }
  });
  test.afterAll(async () => {
    await dbQuery("contract", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
    await dbQuery("client", "deleteMany", { where: { name: { startsWith: "Layout Client" } } });
    await cleanupTestData(fixtures);
  });
  test.beforeEach(async ({ context, baseURL }) => {
    await actAsOwner(context, baseURL!);
  });

  test("at the end of every list and form page, at every size, the widget covers no visible control and adds no horizontal overflow", async ({ page }) => {
    test.setTimeout(240_000);
    const failures: string[] = [];
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      for (const path of [...LIST_PAGES, ...FORM_PAGES]) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await expect(page.getByRole("button", { name: /^Feedback:/ })).toBeVisible();
        await scrollToEnd(page);
        const covered = await coveredByWidget(page);
        const overflow = await horizontalOverflow(page);
        if (covered.length) failures.push(`${viewport.width}x${viewport.height} ${path}: covered ${covered.join(", ")}`);
        if (overflow > 0) failures.push(`${viewport.width}x${viewport.height} ${path}: horizontal overflow ${overflow}px`);
      }
    }
    expect(failures).toEqual([]);
  });

  test("the pagination 'Next' link on page 1 of a long list is fully clickable at the end of the page", async ({ page }) => {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.goto("/clients");
      await page.waitForLoadState("networkidle");
      const next = page.getByRole("link", { name: "Next" });
      await expect(next).toBeVisible();
      await scrollToEnd(page);
      // A real click at the link's bottom-right corner — exactly where the widget used to sit on it (a click at the
      // center would pass either way). Playwright refuses the click if another element would receive it.
      const b = (await next.boundingBox())!;
      await next.click({ position: { x: Math.max(b.width - 4, 1), y: Math.max(b.height - 2, 1) }, timeout: 3000 });
      await expect(page).toHaveURL(/page=2/);
    }
  });

  test("with rows selected, the bulk-action bar's controls stay uncovered", async ({ page }) => {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.goto("/contracts");
      await page.waitForLoadState("networkidle");
      await page.getByRole("checkbox", { name: /Select contract/ }).first().check();
      await expect(page.getByRole("region", { name: "Bulk actions" })).toBeVisible();
      await scrollToEnd(page);
      expect(await coveredByWidget(page), `${viewport.width}x${viewport.height}`).toEqual([]);
    }
  });

  test("form pages: Save and Cancel remain clickable at the end of the page on a phone and on desktop", async ({ page }) => {
    for (const viewport of [VIEWPORTS[0], VIEWPORTS[3]]) {
      await page.setViewportSize(viewport);
      await page.goto("/clients/new");
      await page.waitForLoadState("networkidle");
      await scrollToEnd(page);
      const actions = page.getByRole("button", { name: /^(Save|Create|Add)/ }).or(page.getByRole("link", { name: /^Cancel$/ }));
      expect(await actions.count()).toBeGreaterThan(0);
      for (const control of await actions.all()) {
        const b = await control.boundingBox();
        if (!b) continue;
        const cover = await page.evaluate(({ x, y }) => {
          const widget = document.querySelector<HTMLElement>('button[aria-label^="Feedback"]')!;
          return document.elementsFromPoint(x, y).includes(widget);
        }, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
        expect(cover, `${viewport.width}x${viewport.height} ${await control.textContent()}`).toBe(false);
      }
    }
  });

  test("on a page shorter than the window the clearance takes room from <main> and adds no scroll", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.goto("/requests");
    await page.waitForLoadState("networkidle");
    const height = () => page.evaluate(() => document.documentElement.scrollHeight);
    const withClearance = await height();
    await page.getByTestId("feedback-widget-clearance").evaluate((el) => ((el as HTMLElement).style.display = "none"));
    const withoutClearance = await height();
    expect(withClearance).toBe(withoutClearance);
  });

  test("the clearance is desktop-only: phones rely on the bottom navigation's own spacer", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard");
    await expect(page.getByTestId("feedback-widget-clearance")).toBeHidden();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByTestId("feedback-widget-clearance")).toBeAttached();
    const h = await page.getByTestId("feedback-widget-clearance").evaluate((el) => el.getBoundingClientRect().height);
    expect(h).toBe(20);
  });
});
