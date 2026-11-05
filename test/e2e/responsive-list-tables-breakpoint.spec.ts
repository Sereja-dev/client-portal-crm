import { test, expect, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
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

// Recurring Invoices list fixtures (isolated, run-scoped, removed in afterAll
// before cleanupTestData so the client/project FKs never block it).
const RECURRING_STAMP = `${Date.now()}`;
const LONG_NAME = "Quarterly managed retainer for the whole engineering and design organisation including all regional teams";
const SHORT_STAMP = RECURRING_STAMP.slice(-6);
const RECURRING = {
  full: {
    name: `RLR full schedule ${RECURRING_STAMP}`,
    prefix: `RF${SHORT_STAMP}-`,
    sequence: 7,
    generated: 2,
  },
  longPaused: { name: LONG_NAME, prefix: `RL${SHORT_STAMP}-`, sequence: 12, generated: 0 },
  untitled: { prefix: `RU${SHORT_STAMP}-`, sequence: 1, generated: 0 },
};
const NEXT_ISSUE = new Date("2031-03-15T00:00:00.000Z");
const NEXT_ISSUE_DISPLAY = NEXT_ISSUE.toLocaleDateString(undefined, { timeZone: "UTC" });
let recurringScheduleIds: { full: string; longPaused: string; untitled: string };

async function createSchedule(data: {
  name: string | null;
  prefix: string;
  sequence: number;
  frequency: string;
  status: string;
  projectId: string | null;
}): Promise<string> {
  const schedule = await dbQuery<{ id: string }>("recurringInvoice", "create", {
    data: {
      name: data.name,
      organizationId: fixtures.orgA.id,
      clientId: fixtures.clientA.id,
      projectId: data.projectId,
      frequency: data.frequency,
      anchorDay: 15,
      nextIssueDate: NEXT_ISSUE,
      invoiceNumberPrefix: data.prefix,
      nextSequence: data.sequence,
      currency: "USD",
      status: data.status,
      lineItems: { create: [{ description: "Retainer", quantity: "1", unitPrice: "100", position: 0 }] },
    },
  });
  return schedule.id;
}

test.beforeAll(async () => {
  fixtures = await seedE2EFixtures();
  recurringScheduleIds = {
    full: await createSchedule({
      name: RECURRING.full.name,
      prefix: RECURRING.full.prefix,
      sequence: RECURRING.full.sequence,
      frequency: "MONTHLY",
      status: "ACTIVE",
      projectId: fixtures.project.id,
    }),
    longPaused: await createSchedule({
      name: RECURRING.longPaused.name,
      prefix: RECURRING.longPaused.prefix,
      sequence: RECURRING.longPaused.sequence,
      frequency: "QUARTERLY",
      status: "PAUSED",
      projectId: null,
    }),
    untitled: await createSchedule({
      name: null,
      prefix: RECURRING.untitled.prefix,
      sequence: RECURRING.untitled.sequence,
      frequency: "WEEKLY",
      status: "ACTIVE",
      projectId: null,
    }),
  };
  for (let i = 0; i < RECURRING.full.generated; i++) {
    await dbQuery("invoice", "create", {
      data: {
        invoiceNumber: `${RECURRING.full.prefix}gen-${i}`,
        amount: "100",
        currency: "USD",
        clientId: fixtures.clientA.id,
        organizationId: fixtures.orgA.id,
        recurringInvoiceId: recurringScheduleIds.full,
      },
    });
  }
});

test.afterAll(async () => {
  await dbQuery("invoice", "deleteMany", { where: { recurringInvoiceId: { in: Object.values(recurringScheduleIds) } } });
  await dbQuery("recurringInvoice", "deleteMany", { where: { id: { in: Object.values(recurringScheduleIds) } } });
  await cleanupTestData(fixtures);
});

test.beforeEach(async ({ context, baseURL }) => {
  await injectTestSession(context, { id: fixtures.owner.id, email: fixtures.owner.email }, baseURL!);
});

const WIDTHS = [320, 375, 390, 767, 768, 800, 900, 1024, 1100, 1200, 1279, 1280, 1440];
const SURFACES = ["/clients", "/projects", "/tasks", "/invoices", "/team", "/recurring-invoices"];

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
        // The mobile card list is RecordList's <ul class="… xl:hidden"> (src/components/ui/record-list.tsx).
        // A bare `ul` also matches the sidebar's collapsed group menus, which are hidden at every width.
        const cardLists = page.locator('ul[class~="xl:hidden"]');

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

/**
 * Recurring Invoices list — the eight-column table used to be shown from `md`
 * with columns appearing by breakpoint (`sm`/`md`/`lg`), so the sidebar's
 * 224px at `md` left it clipped inside its own scroller at 320–430,
 * 768–850 and 1024–1075px. Below `xl` it is now the shared card list, which
 * must carry all eight fields; from `xl` the table must show all eight
 * columns and fit.
 */
const RECURRING_WIDTHS = [320, 390, 640, 768, 1024, 1279, 1280];
const RECURRING_HEADERS = ["Name", "Client", "Project", "Frequency", "Next issue date", "Status", "Next invoice", "Generated"];

async function expectNoDocumentOverflow(page: Page, label: string) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `${label}: document must not scroll horizontally`).toBeLessThanOrEqual(clientWidth);
}

test.describe("/recurring-invoices — card list below xl, full table from xl", () => {
  for (const width of RECURRING_WIDTHS) {
    const tableShown = width >= 1280;

    test(`at ${width}px: ${tableShown ? "table with all eight columns, cards hidden" : "cards with all eight fields, table hidden"}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/recurring-invoices");

      const cardList = page.locator('ul[class~="xl:hidden"]').filter({ hasText: RECURRING.full.name });
      const table = page.locator("table");
      const scheduleHref = `/recurring-invoices/${recurringScheduleIds.full}`;

      if (!tableShown) {
        await expect(cardList).toBeVisible();
        await expect(table).toBeHidden();
        // The hidden table is display:none, so its links are not accessible: exactly one link per schedule.
        await expect(page.getByRole("link", { name: RECURRING.full.name })).toHaveCount(1);

        const card = cardList.locator("li").filter({ hasText: RECURRING.full.name });
        await expect(card).toHaveCount(1);
        for (const label of RECURRING_HEADERS) {
          await expect(card.getByText(label, { exact: true }), `card label ${label}`).toBeVisible();
        }
        await expect(card.getByRole("link", { name: RECURRING.full.name })).toHaveAttribute("href", scheduleHref);
        await expect(card).toContainText(fixtures.clientA.name);
        await expect(card).toContainText(fixtures.project.name);
        await expect(card).toContainText("Monthly");
        await expect(card).toContainText(NEXT_ISSUE_DISPLAY);
        await expect(card).toContainText("Active");
        await expect(card).toContainText(`${RECURRING.full.prefix}${RECURRING.full.sequence}`);
        // Generated count is the last field's value.
        await expect(card.locator("div", { has: page.getByText("Generated", { exact: true }) }).last()).toContainText(
          String(RECURRING.full.generated),
        );

        // Missing optional data: no-project and zero-generated fall back, an empty name reads "Untitled schedule".
        const untitled = cardList.locator("li").filter({ hasText: `${RECURRING.untitled.prefix}${RECURRING.untitled.sequence}` });
        await expect(untitled.getByRole("link", { name: "Untitled schedule" })).toHaveAttribute(
          "href",
          `/recurring-invoices/${recurringScheduleIds.untitled}`,
        );
        await expect(untitled).toContainText("Weekly");
        const untitledProject = untitled.locator("div", { has: page.getByText("Project", { exact: true }) }).last();
        await expect(untitledProject).toContainText("—");
        const untitledGenerated = untitled.locator("div", { has: page.getByText("Generated", { exact: true }) }).last();
        await expect(untitledGenerated).toContainText("0");

        // Long name + Paused: wraps inside the card, nothing leaves the card or the viewport.
        const longCard = cardList.locator("li").filter({ hasText: RECURRING.longPaused.prefix });
        await expect(longCard.getByRole("link", { name: LONG_NAME })).toBeVisible();
        await expect(longCard).toContainText("Paused");
        await expect(longCard).toContainText("Quarterly");

        // No field clipped outside its card.
        for (const li of await cardList.locator("li").all()) {
          const cardBox = await li.boundingBox();
          expect(cardBox).not.toBeNull();
          const outside = await li.evaluate((el) => {
            const box = el.getBoundingClientRect();
            return Array.from(el.querySelectorAll("span, a"))
              .map((child) => child.getBoundingClientRect())
              .filter((r) => r.width > 0 && (r.left < box.left - 0.5 || r.right > box.right + 0.5))
              .length;
          });
          expect(outside, "no label/value may extend beyond its card").toBe(0);
          expect(cardBox!.x + cardBox!.width, "card within viewport").toBeLessThanOrEqual(width);
        }

        // Keyboard: the link is reachable by Tab and shows a visible focus ring.
        const link = card.getByRole("link", { name: RECURRING.full.name });
        await link.focus();
        await expect(link).toBeFocused();
        await expect.poll(() => link.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe("none");
      } else {
        await expect(table).toBeVisible();
        await expect(page.locator('ul[class~="xl:hidden"]')).toBeHidden();
        await expect(page.getByRole("link", { name: RECURRING.full.name })).toHaveCount(1);
        const headers = table.getByRole("columnheader");
        await expect(headers).toHaveText(RECURRING_HEADERS);

        const row = table.getByRole("row").filter({ hasText: RECURRING.full.name });
        await expect(row.getByRole("link", { name: RECURRING.full.name })).toHaveAttribute("href", scheduleHref);
        const cells = row.getByRole("cell");
        await expect(cells).toHaveText([
          RECURRING.full.name,
          fixtures.clientA.name,
          fixtures.project.name,
          "Monthly",
          NEXT_ISSUE_DISPLAY,
          "Active",
          `${RECURRING.full.prefix}${RECURRING.full.sequence}`,
          String(RECURRING.full.generated),
        ]);

        const geometry = await measureTableFit(page);
        for (const t of geometry) {
          expect(t.scrollWidth, "table must fit its container at 1280px with the long-name fixture present").toBeLessThanOrEqual(
            t.containerClientWidth + 1,
          );
        }
      }
      await expectNoDocumentOverflow(page, `/recurring-invoices at ${width}px`);
    });
  }
});

test.describe("/recurring-invoices — an unbroken long name wraps inside its card", () => {
  for (const width of [320, 390]) {
    test(`at ${width}px: a 60-character unbreakable name stays inside its card and the page`, async ({ page }) => {
      const token = `U${"x".repeat(59)}`;
      const id = await createSchedule({
        name: token,
        prefix: `RT${SHORT_STAMP}-`,
        sequence: 3,
        frequency: "YEARLY",
        status: "ACTIVE",
        projectId: null,
      });
      try {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/recurring-invoices");
        const link = page.getByRole("link", { name: token });
        await expect(link).toBeVisible();
        await expect(link).toHaveAttribute("href", `/recurring-invoices/${id}`);
        const card = page.locator("li").filter({ has: link });
        const contained = await card.evaluate((el, linkText) => {
          const box = el.getBoundingClientRect();
          const a = Array.from(el.querySelectorAll("a")).find((n) => n.textContent === linkText)!.getBoundingClientRect();
          return a.left >= box.left - 0.5 && a.right <= box.right + 0.5;
        }, token);
        expect(contained, "the unbreakable name must wrap inside its card").toBe(true);
        await expectNoDocumentOverflow(page, `/recurring-invoices unbreakable name at ${width}px`);
      } finally {
        await dbQuery("recurringInvoice", "deleteMany", { where: { id } });
      }
    });
  }
});

/**
 * Valid-but-extreme content at desktop width. Limits come from the real
 * validation: name <= RECURRING_INVOICE_NAME_MAX_LENGTH (200, any characters,
 * no whitespace required) and prefix <= INVOICE_NUMBER_PREFIX_MAX_LENGTH (40)
 * with a sequence up to 1,000,000,000 (10 digits). An unbroken 200-character
 * name used to stretch the table to ~2500px, pushing seven of the eight
 * columns out of the 942px scroller at 1280px where only a pointer (or a
 * wheel) could reveal them: the wrapper has no tabindex and its only focusable
 * child is the Name link, so a keyboard user could not reach them. Every
 * column must now be visible without any inner scrolling.
 */
test.describe("/recurring-invoices — longest valid values stay fully readable in the desktop table", () => {
  const LONGEST_NAME = `L${"y".repeat(199)}`;
  const LONGEST_PREFIX = `P${"z".repeat(39)}`;
  const LONGEST_SEQUENCE = 1_000_000_000;

  for (const width of [1280, 1440]) {
    test(`at ${width}px: all eight columns and the full name and invoice number are visible with no inner scrolling`, async ({
      page,
    }) => {
      const id = await createSchedule({
        name: LONGEST_NAME,
        prefix: LONGEST_PREFIX,
        sequence: LONGEST_SEQUENCE,
        frequency: "QUARTERLY",
        status: "ACTIVE",
        projectId: fixtures.project.id,
      });
      try {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/recurring-invoices");
        const table = page.locator("table");
        await expect(table).toBeVisible();
        const link = table.getByRole("link", { name: LONGEST_NAME });
        await expect(link).toHaveAttribute("href", `/recurring-invoices/${id}`);

        const row = table.getByRole("row").filter({ has: page.getByRole("link", { name: LONGEST_NAME }) });
        await expect(row.getByRole("cell")).toHaveText([
          LONGEST_NAME,
          fixtures.clientA.name,
          fixtures.project.name,
          "Quarterly",
          NEXT_ISSUE_DISPLAY,
          "Active",
          `${LONGEST_PREFIX}${LONGEST_SEQUENCE}`,
          "0",
        ]);
        await expect(table.getByRole("columnheader")).toHaveText(RECURRING_HEADERS);

        // Nothing needs scrolling to be read: the wrapper holds the whole table.
        const geometry = await measureTableFit(page);
        for (const t of geometry) {
          expect(t.scrollWidth, "the table must not need an inner horizontal scroll").toBeLessThanOrEqual(t.containerClientWidth + 1);
        }
        // Every header and every cell of the long row lies inside the wrapper, without any scrolling.
        const outside = await page.evaluate((linkText) => {
          const t = Array.from(document.querySelectorAll("table")).find((n) => n.textContent!.includes(linkText))!;
          const wrapper = t.parentElement!.getBoundingClientRect();
          const tr = Array.from(t.querySelectorAll("tbody tr")).find((r) => r.textContent!.includes(linkText))!;
          return [...Array.from(t.querySelectorAll("th")), ...Array.from(tr.querySelectorAll("td"))]
            .filter((c) => {
              const r = c.getBoundingClientRect();
              return r.left < wrapper.left - 0.5 || r.right > wrapper.right + 0.5;
            })
            .map((c) => c.textContent!.slice(0, 20));
        }, LONGEST_NAME);
        expect(outside, "cells/headers outside the visible table area").toEqual([]);

        // The Name link keeps a visible focus ring.
        await link.focus();
        await expect(link).toBeFocused();
        await expect.poll(() => link.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe("none");

        await expectNoDocumentOverflow(page, `/recurring-invoices longest valid values at ${width}px`);
      } finally {
        await dbQuery("recurringInvoice", "deleteMany", { where: { id } });
      }
    });
  }
});
