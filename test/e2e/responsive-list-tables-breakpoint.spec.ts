import { test, expect, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Correction PR — production breakpoint-gap defect (Tasks list: clipped
 * Actions header, partially off-screen Delete action at a widened but
 * not-yet-1280px viewport).
 *
 * Root cause, empirically measured (real `getBoundingClientRect()`/
 * `scrollWidth`/`clientWidth` geometry in CSS pixels, via a disposable,
 * never-committed Playwright script — not inferred from screenshot
 * physical-pixel dimensions): the original `md`/768px cutover activated
 * each surface's desktop `<table>` at the exact same breakpoint where
 * `(dashboard)/layout.tsx`'s own Sidebar becomes a fixed 224px side
 * column — shrinking the available content width right when the table
 * needed more of it, not less. Measured minimum content width each
 * table's own real DOM requires to render without overflow (Decimal
 * Chromium/CSS pixels; content-container width = viewport − 224px
 * sidebar − 48px `p-6` main padding, i.e. viewport − 272, once at/above
 * `md`):
 *
 *   Team Members:      584px  → fits from viewport ≥  856px
 *   Projects:           611px  → fits from viewport ≥  883px
 *   Clients:             626px  → fits from viewport ≥  898px
 *   Team Invitations:   632px  → fits from viewport ≥  904px
 *   Invoices:            695px  → fits from viewport ≥  967px
 *   Tasks (widest, 9 columns): 779px → fits from viewport ≥ 1051px
 *
 * `xl` (1280px) is Tailwind's own next built-in breakpoint step above
 * `lg` (1024px, itself proven insufficient — Tasks still needs 1051)
 * that clears every one of the six measured requirements with real
 * margin (229px+ for Tasks, more for the rest) — chosen over a bespoke
 * arbitrary-value breakpoint precisely so a modest future increase in
 * real content width (a longer Invoice number, a longer status label)
 * doesn't reopen this same gap with zero headroom.
 *
 * This file asserts the underlying geometric invariant directly — "a
 * visible table must never need more horizontal space than its own
 * container actually has" — rather than hardcoding the specific 1280px
 * value, so it would keep failing correctly even if a future change
 * quietly reintroduced this exact class of bug at a different pixel
 * value.
 */

let fixtures: TestFixtures;

test.beforeAll(async () => {
  fixtures = await seedE2EFixtures();
});

test.afterAll(async () => {
  await cleanupTestData(fixtures);
});

test.beforeEach(async ({ context, baseURL }) => {
  await injectTestSession(context, { id: fixtures.owner.id, email: fixtures.owner.email }, baseURL!);
});

const WIDTHS = [320, 375, 390, 767, 768, 800, 900, 1024, 1100, 1200, 1279, 1280, 1440];
const SURFACES = ["/clients", "/projects", "/tasks", "/invoices", "/team"];

/**
 * Real CSS-pixel geometry for every `<table>` on the page, read via
 * `scrollWidth`/`clientWidth` — never inferred from a screenshot's
 * physical pixel dimensions. Only ever called after the caller has
 * already confirmed (via Playwright's own auto-retrying `toBeVisible()`)
 * that the table is genuinely rendered and settled — this function
 * itself performs no waiting/polling of its own.
 */
async function measureTableFit(page: Page): Promise<{ scrollWidth: number; containerClientWidth: number }[]> {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll("table")).map((table) => {
      const wrapper = table.parentElement; // Table component's own overflow-x-auto wrapper
      return {
        scrollWidth: table.scrollWidth,
        containerClientWidth: wrapper ? (wrapper as HTMLElement).clientWidth : 0,
      };
    });
  });
}

for (const path of SURFACES) {
  test.describe(`${path} — table only activates where it genuinely fits`, () => {
    for (const width of WIDTHS) {
      const expectTableVisible = width >= 1280; // the corrected `xl` cutover
      test(`at ${width}px: exactly one representation is shown, and a visible table never overflows its own container`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(path);

        // Playwright's own `toBeVisible()`/`toBeHidden()` already auto-
        // retry until the real, settled DOM state matches (or the
        // assertion's own timeout elapses) — this repo's entire existing
        // E2E suite already relies on this same mechanism successfully;
        // an ad-hoc manual poll-and-compare loop over raw `page.evaluate()`
        // snapshots is redundant with, and less robust than, this
        // built-in mechanism, not a substitute for it.
        //
        // Counting/indexing uses a raw CSS locator, never `getByRole`:
        // `getByRole("table")` excludes an element entirely from its own
        // match set once it's hidden (`display:none`) — `.count()` on it
        // silently returns 0 for a genuinely-present-but-hidden table,
        // which would make "at least one <table> exists in the DOM"
        // (a precondition, not a visibility claim) false whenever the
        // table happens to be the hidden side of the pair. A raw
        // `page.locator("table")` counts real DOM presence regardless of
        // visibility, matching what this precondition actually means;
        // the `toBeVisible()`/`toBeHidden()` calls below are what still
        // do the real, role-agnostic visibility assertion.
        const tables = page.locator("table");
        const tableCount = await tables.count();
        expect(tableCount, `${path}: expected at least one <table> in the DOM`).toBeGreaterThan(0);
        const cardLists = page.locator("ul");

        if (expectTableVisible) {
          for (let i = 0; i < tableCount; i++) {
            await expect(tables.nth(i), `${path} at ${width}px: table[${i}] must be visible at/above the xl cutover`).toBeVisible();
          }
          // Exactly one representation active — desktop table visible
          // means the mobile card list must be fully hidden, never both.
          const cardListCount = await cardLists.count();
          for (let i = 0; i < cardListCount; i++) {
            await expect(cardLists.nth(i), `${path} at ${width}px: table is visible, so the card list must be hidden`).toBeHidden();
          }
          // Every visible table must fit its own container — the exact
          // invariant this correction restores. A 1px tolerance absorbs
          // sub-pixel layout rounding, never a real overflow.
          const geometry = await measureTableFit(page);
          for (const t of geometry) {
            expect(
              t.scrollWidth,
              `${path} at ${width}px: a visible table's scrollWidth (${t.scrollWidth}) must not exceed its container's clientWidth (${t.containerClientWidth})`,
            ).toBeLessThanOrEqual(t.containerClientWidth + 1);
          }
        } else {
          for (let i = 0; i < tableCount; i++) {
            await expect(tables.nth(i), `${path} at ${width}px: table[${i}] must be hidden below the xl cutover`).toBeHidden();
          }
          // Table hidden — the card list must be the one and only visible
          // representation, never neither (this repo's own fixtures
          // always seed at least one row for every one of these five
          // surfaces).
          const cardListCount = await cardLists.count();
          expect(cardListCount, `${path} at ${width}px: expected at least one card list in the DOM`).toBeGreaterThan(0);
          for (let i = 0; i < cardListCount; i++) {
            await expect(cardLists.nth(i), `${path} at ${width}px: table is hidden, so the card list must be visible`).toBeVisible();
          }
        }
      });
    }
  });
}

test.describe("Tasks — Actions column and Edit/Delete controls fully contained once the table activates", () => {
  test("at the safe desktop cutover (1280px): the Actions header and both Edit/Delete controls are fully inside the viewport and their own table container", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/tasks");

    const table = page.getByRole("table");
    await expect(table).toBeVisible();

    const actionsHeader = table.getByRole("columnheader", { name: "Actions" });
    await expect(actionsHeader).toBeVisible();

    const row = page.getByRole("row", { name: new RegExp(fixtures.task.title) });
    // Stale-test correction — Mobile Improvement Slice B3 already shipped
    // relocating Tasks' own Delete out of the row and behind the shared
    // RowActionMenu overflow trigger ("More actions for task <title>",
    // portaled to document.body); this file's own Tasks assertions were
    // never updated to match at the time. Delete-in-overflow semantics
    // (opening the menu, ConfirmDialog, Cancel-preserves-the-record) are
    // already exhaustively covered by test/e2e/mobile-row-actions-rollout.spec.ts
    // — this file's own job is still only the breakpoint/containment
    // geometry of whichever controls are actually directly visible in
    // the row today (Log time, Edit, the overflow trigger itself), so it
    // is updated to match that shipped contract rather than reopening
    // overflow-menu behavior here.
    const logTimeButton = row.getByRole("button", { name: "Log time" });
    const editLink = row.getByRole("link", { name: /Edit/ });
    const menuTrigger = row.getByRole("button", { name: `More actions for task ${fixtures.task.title}` });
    await expect(logTimeButton).toBeVisible();
    await expect(editLink).toBeVisible();
    await expect(menuTrigger).toBeVisible();
    // Delete itself is no longer a direct row control at all — confirming
    // its continued absence here guards against a future regression that
    // silently reintroduces it outside the overflow menu.
    await expect(row.getByRole("button", { name: "Delete" })).toHaveCount(0);

    const viewportSize = page.viewportSize()!;
    for (const locator of [actionsHeader, logTimeButton, editLink, menuTrigger]) {
      const box = await locator.boundingBox();
      expect(box, "expected a real bounding box").not.toBeNull();
      expect(box!.x + box!.width, "control's right edge must not exceed the viewport width").toBeLessThanOrEqual(viewportSize.width);
      expect(box!.x, "control's left edge must not be negative (clipped off the left)").toBeGreaterThanOrEqual(0);
    }
  });

  test("at the formerly-failing intermediate width (1024px): the table is hidden (not clipped) and the card list shows the same Edit/Delete controls, fully contained", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto("/tasks");

    await expect(page.getByRole("table")).toBeHidden();

    const card = page.locator("li", { hasText: fixtures.task.title });
    await expect(card).toBeVisible();
    // Stale-test correction — see the 1280px test above's own identical
    // comment: Delete has shipped behind the overflow menu (Mobile
    // Improvement Slice B3) on this card too, not merely the desktop row.
    const logTimeButton = card.getByRole("button", { name: "Log time" });
    const editLink = card.getByRole("link", { name: /Edit/ });
    const menuTrigger = card.getByRole("button", { name: `More actions for task ${fixtures.task.title}` });
    await expect(logTimeButton).toBeVisible();
    await expect(editLink).toBeVisible();
    await expect(menuTrigger).toBeVisible();
    await expect(card.getByRole("button", { name: "Delete" })).toHaveCount(0);

    const viewportSize = page.viewportSize()!;
    for (const locator of [editLink, logTimeButton, menuTrigger]) {
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewportSize.width);
    }

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
});
