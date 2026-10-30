import { expect, type Locator, type Page } from "@playwright/test";

// E2E test files cannot import @/lib/prisma directly — Playwright Test's
// own transform can't load the generated Prisma client (see test/e2e/
// db-server.ts's header comment). These re-exports are the HTTP-backed
// equivalents test/e2e specs should use instead; the underlying fixture
// graph is identical to Stage 4's (test/fixtures/seed.ts), just reached
// over test/e2e/db-server.ts rather than in-process.
export { seedFixtures as seedE2EFixtures, cleanupFixtures as cleanupTestData, dbQuery } from "../support/e2e-db-client";
export type { TestFixtures } from "../fixtures/seed";

/**
 * Sidebar Information Architecture — a handful of destinations that used
 * to be direct top-level sidebar links (Analytics, Reports, Calendar,
 * Billing, Activity, Projects, Tasks, Invoices) now live inside a
 * collapsible group (native <details>/<summary>, src/components/layout/
 * sidebar.tsx). A closed group's own child links are not visible/
 * actionable, so any spec clicking or asserting visibility on one of
 * those must open its parent group first — this one shared helper is
 * that open step, used instead of duplicating the same DOM manipulation
 * in every affected spec file.
 *
 * Sets the real native `open` property directly (never a `.click()` on
 * the <summary>, whose own implicit ARIA role isn't worth depending on
 * here) — idempotent and safe to call even when the group already
 * happens to be open (e.g. because it's already the active section).
 * `nav` is always the already-scoped Primary sidebar `<nav>` locator the
 * calling spec already has.
 */
export async function openSidebarGroup(nav: Locator, groupLabel: string): Promise<void> {
  const summary = nav.locator("summary", { hasText: groupLabel });
  await summary.evaluate((el) => {
    const details = el.closest("details");
    if (details) details.open = true;
  });
}

/**
 * Asserts the page has no horizontal overflow (same condition as comparing
 * document scrollWidth with clientWidth), and when it does, names what overflows
 * so a failure on CI (where layout can differ slightly from a developer machine)
 * points at the element instead of just "expected false, received true".
 * Elements clipped by a scroll container that itself fits are not offenders.
 */
export async function expectNoHorizontalPageOverflow(page: Page): Promise<void> {
  const detail = await page.evaluate(() => {
    const de = document.documentElement;
    if (de.scrollWidth <= de.clientWidth) return null;
    const limit = de.clientWidth;
    const desc = (e: Element) =>
      `${e.tagName.toLowerCase()}${(e.getAttribute("class") || "").split(/\s+/).filter(Boolean).slice(0, 5).map((c) => "." + c).join("")}`;
    const clipper = (e: Element): Element | null => {
      for (let p = e.parentElement; p && p !== de; p = p.parentElement) if (getComputedStyle(p).overflowX !== "visible") return p;
      return null;
    };
    const fits = (e: Element) => {
      const c = clipper(e);
      return c !== null && c.getBoundingClientRect().right <= limit + 1;
    };
    const offenders: string[] = [];
    for (const e of document.body.querySelectorAll("*")) {
      const right = e.getBoundingClientRect().right;
      if (right > limit + 1 && !fits(e)) offenders.push(`${desc(e)} (right=${Math.round(right)})`);
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent || "").trim();
      const parent = n.parentElement;
      if (!text || !parent || fits(parent)) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const right = Math.max(...[...range.getClientRects()].map((r) => r.right), 0);
      if (right > limit + 1) offenders.push(`text "${text.slice(0, 40)}" in ${desc(parent)} (right=${Math.round(right)})`);
    }
    return `scrollWidth ${de.scrollWidth} > clientWidth ${de.clientWidth}; overflowing: ${offenders.slice(0, 6).join(" | ") || "none found"}`;
  });
  expect(detail, "page-level horizontal overflow").toBeNull();
}
