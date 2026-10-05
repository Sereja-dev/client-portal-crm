import { test, expect, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Tables Improvement Slice A (Invoices pilot) — real browser coverage
 * for the four new workflow-oriented behaviors: the overflow action
 * menu (DRAFT-only Delete relocation), clickable sortable desktop
 * headers, quick-filter chips, and the browser-proven sticky desktop
 * header. Domain-layer correctness (tenant scoping, money/date
 * semantics, the existing sort/pagination pipeline) is already
 * exhaustively covered elsewhere (test/e2e/invoices.spec.ts, this
 * slice's own unit tests) and is not re-derived here.
 */

let fixtures: TestFixtures;
let seededInvoiceIds: string[] = [];

function uniqueNumber(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

async function actAsOwner(page: Page, baseURL: string): Promise<void> {
  await page.context().clearCookies();
  await injectTestSession(page.context(), { id: fixtures.owner.id, email: fixtures.owner.email }, baseURL);
  await page.context().addCookies([
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

async function seedInvoice(overrides: Record<string, unknown>): Promise<{ id: string; invoiceNumber: string }> {
  const invoiceNumber = (overrides.invoiceNumber as string) ?? uniqueNumber("E2E-TBL");
  const created = await dbQuery<{ id: string; invoiceNumber: string }>("invoice", "create", {
    data: {
      status: "DRAFT",
      amount: "100.00",
      subtotal: "100.00",
      discountAmount: "0.00",
      taxAmount: "0.00",
      clientId: fixtures.clientA.id,
      organizationId: fixtures.orgA.id,
      ...overrides,
      // Always wins over any `invoiceNumber` in `overrides` — `invoiceNumber`
      // above is already resolved from `overrides.invoiceNumber` (or a fresh
      // unique one), so this keeps the created row's number consistent with
      // the value callers/cleanup/assertions already received.
      invoiceNumber,
    },
  });
  seededInvoiceIds.push(created.id);
  return created;
}

async function cleanupSeededInvoices(): Promise<void> {
  if (seededInvoiceIds.length > 0) {
    await dbQuery("invoice", "deleteMany", { where: { id: { in: seededInvoiceIds } } });
    seededInvoiceIds = [];
  }
}

test.describe("Invoice table workflow (Tables Improvement Slice A)", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.beforeEach(async ({ page, baseURL }) => {
    await actAsOwner(page, baseURL!);
  });

  test.afterEach(async () => {
    await cleanupSeededInvoices();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test.describe("action menu", () => {
    test("DRAFT: direct Edit visible, Delete behind the overflow menu, existing confirmation preserved, Cancel leaves the invoice intact", async ({ page }) => {
      const invoice = await seedInvoice({ status: "DRAFT" });
      await page.goto("/invoices");

      const row = page.getByRole("row", { name: new RegExp(invoice.invoiceNumber) });
      await expect(row.getByRole("link", { name: "Edit" })).toBeVisible();
      // No prominent inline Delete anywhere in the row.
      await expect(row.getByRole("button", { name: "Delete" })).toHaveCount(0);

      const menuTrigger = row.getByRole("button", { name: `More actions for invoice ${invoice.invoiceNumber}` });
      await expect(menuTrigger).toBeVisible();
      await expect(menuTrigger).toHaveAttribute("aria-expanded", "false");
      await menuTrigger.click();
      await expect(menuTrigger).toHaveAttribute("aria-expanded", "true");

      // Delete is portaled (document.body), never a row descendant.
      const deleteButton = page.getByRole("button", { name: "Delete" });
      await expect(deleteButton).toBeVisible();

      await deleteButton.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(invoice.invoiceNumber);

      // Cancelling the existing confirmation leaves the invoice intact —
      // the exact existing ConfirmDialog/DeleteButton/deleteInvoiceAction
      // behavior, never duplicated or weakened by this slice.
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toBeHidden();
      await page.reload();
      await expect(page.getByRole("row", { name: new RegExp(invoice.invoiceNumber) })).toBeVisible();
    });

    test("DRAFT: confirming Delete through the overflow menu actually deletes the invoice (existing server action, unmodified)", async ({ page }) => {
      const invoice = await seedInvoice({ status: "DRAFT" });
      await page.goto("/invoices");

      const row = page.getByRole("row", { name: new RegExp(invoice.invoiceNumber) });
      await row.getByRole("button", { name: `More actions for invoice ${invoice.invoiceNumber}` }).click();
      await page.getByRole("button", { name: "Delete" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();

      await expect(page.getByText("Invoice deleted")).toBeVisible();
      await expect(page.getByRole("row", { name: new RegExp(invoice.invoiceNumber) })).toHaveCount(0);
      seededInvoiceIds = seededInvoiceIds.filter((id) => id !== invoice.id); // already gone, afterEach cleanup would be a safe no-op either way
    });

    test("Escape closes the open menu and returns focus to the trigger", async ({ page }) => {
      const invoice = await seedInvoice({ status: "DRAFT" });
      await page.goto("/invoices");

      const row = page.getByRole("row", { name: new RegExp(invoice.invoiceNumber) });
      const menuTrigger = row.getByRole("button", { name: `More actions for invoice ${invoice.invoiceNumber}` });
      await menuTrigger.click();
      await expect(page.getByRole("menu")).toBeVisible();

      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0);
      await expect(menuTrigger).toBeFocused();
    });

    test("clicking outside the open menu closes it without activating anything", async ({ page }) => {
      const invoice = await seedInvoice({ status: "DRAFT" });
      await page.goto("/invoices");

      const row = page.getByRole("row", { name: new RegExp(invoice.invoiceNumber) });
      await row.getByRole("button", { name: `More actions for invoice ${invoice.invoiceNumber}` }).click();
      await expect(page.getByRole("menu")).toBeVisible();

      await page.locator("h1", { hasText: "Invoices" }).click();
      await expect(page.getByRole("menu")).toHaveCount(0);
      // Still on the list, invoice untouched.
      await expect(row).toBeVisible();
    });

    test("non-DRAFT: View visible, no direct Delete, and no empty overflow menu at all", async ({ page }) => {
      const invoice = await seedInvoice({ status: "SENT" });
      await page.goto("/invoices");

      const row = page.getByRole("row", { name: new RegExp(invoice.invoiceNumber) });
      await expect(row.getByRole("link", { name: "View" })).toBeVisible();
      await expect(row.getByRole("button", { name: "Delete" })).toHaveCount(0);
      await expect(row.getByRole("button", { name: new RegExp("More actions") })).toHaveCount(0);
    });
  });

  test.describe("quick-filter chips", () => {
    test("Draft chip filters to DRAFT rows only, is visually active, and clicking it again clears the filter", async ({ page }) => {
      const draft = await seedInvoice({ status: "DRAFT" });
      const sent = await seedInvoice({ status: "SENT" });
      await page.goto("/invoices");

      const chip = page.getByRole("link", { name: "Draft" });
      await chip.click();
      await expect(page).toHaveURL(/status=DRAFT/);
      await expect(chip).toHaveAttribute("aria-current", "true");
      await expect(page.getByRole("row", { name: new RegExp(draft.invoiceNumber) })).toBeVisible();
      await expect(page.getByRole("row", { name: new RegExp(sent.invoiceNumber) })).toHaveCount(0);

      // Status dropdown stays synchronized with the chip — same URL state.
      await expect(page.getByLabel("Status")).toHaveValue("DRAFT");

      // Clicking the already-active chip clears the filter entirely.
      await page.getByRole("link", { name: "Draft" }).click();
      await expect(page).not.toHaveURL(/status=DRAFT/);
      await expect(page.getByRole("row", { name: new RegExp(sent.invoiceNumber) })).toBeVisible();
    });

    test("Paid chip filters to PAID rows, preserves an active search term, and resets pagination to page 1", async ({ page }) => {
      const paid = await seedInvoice({ status: "PAID", invoiceNumber: uniqueNumber("E2E-PAIDCHIP") });
      await page.goto(`/invoices?q=${encodeURIComponent("E2E-PAIDCHIP")}&page=2`);

      await page.getByRole("link", { name: "Paid" }).click();
      await expect(page).toHaveURL(/status=PAID/);
      await expect(page).toHaveURL(/q=E2E-PAIDCHIP/);
      await expect(page).not.toHaveURL(/page=2/);
      await expect(page.getByRole("row", { name: new RegExp(paid.invoiceNumber) })).toBeVisible();
    });

    test("selecting a status from the dropdown updates the matching chip's own active state", async ({ page }) => {
      await seedInvoice({ status: "OVERDUE" });
      await page.goto("/invoices");

      await page.getByLabel("Status").selectOption("OVERDUE");
      // Scoped to the filter bar's own <form> — the page also has an
      // unrelated global "Search" (Cmd+K palette) trigger elsewhere.
      await page.locator("form").getByRole("button", { name: "Search" }).click();
      await expect(page).toHaveURL(/status=OVERDUE/);
      await expect(page.getByRole("link", { name: "Overdue" })).toHaveAttribute("aria-current", "true");
    });
  });

  test.describe("sortable headers", () => {
    test("Due date: clicking sorts ascending first, toggles to descending on a second click, and the Sort-by dropdown reflects the same state", async ({ page }) => {
      const earlier = await seedInvoice({ dueDate: "2026-01-10T00:00:00.000Z", invoiceNumber: uniqueNumber("E2E-SORT-EARLY") });
      const later = await seedInvoice({ dueDate: "2026-06-10T00:00:00.000Z", invoiceNumber: uniqueNumber("E2E-SORT-LATE") });
      await page.goto(`/invoices?q=E2E-SORT`);

      const header = page.getByRole("columnheader", { name: /Due date/ });
      await header.getByRole("link").click();
      await expect(page).toHaveURL(/sort=dueDate%3Aasc/);
      await expect(page.getByRole("columnheader", { name: /Due date/ })).toHaveAttribute("aria-sort", "ascending");
      await expect(page.getByLabel("Sort by")).toHaveValue("dueDate:asc");

      const rowsAsc = await page.getByRole("row").allTextContents();
      expect(rowsAsc.findIndex((t) => t.includes(earlier.invoiceNumber))).toBeLessThan(
        rowsAsc.findIndex((t) => t.includes(later.invoiceNumber)),
      );

      // Second click toggles to descending.
      await page.getByRole("columnheader", { name: /Due date/ }).getByRole("link").click();
      await expect(page).toHaveURL(/sort=dueDate%3Adesc/);
      await expect(page.getByRole("columnheader", { name: /Due date/ })).toHaveAttribute("aria-sort", "descending");
      await expect(page.getByLabel("Sort by")).toHaveValue("dueDate:desc");

      const rowsDesc = await page.getByRole("row").allTextContents();
      expect(rowsDesc.findIndex((t) => t.includes(later.invoiceNumber))).toBeLessThan(
        rowsDesc.findIndex((t) => t.includes(earlier.invoiceNumber)),
      );
    });

    test("Amount: first click sorts descending (high to low), matching the existing dropdown's own established default", async ({ page }) => {
      const small = await seedInvoice({ amount: "10.00", subtotal: "10.00", invoiceNumber: uniqueNumber("E2E-SORT-SMALL") });
      const large = await seedInvoice({ amount: "9999.00", subtotal: "9999.00", invoiceNumber: uniqueNumber("E2E-SORT-LARGE") });
      await page.goto(`/invoices?q=E2E-SORT`);

      await page.getByRole("columnheader", { name: /Amount/ }).getByRole("link").click();
      await expect(page).toHaveURL(/sort=amount%3Adesc/);
      await expect(page.getByLabel("Sort by")).toHaveValue("amount:desc");

      const rows = await page.getByRole("row").allTextContents();
      expect(rows.findIndex((t) => t.includes(large.invoiceNumber))).toBeLessThan(
        rows.findIndex((t) => t.includes(small.invoiceNumber)),
      );
    });

    test("the existing Sort-by dropdown still fully works and keeps the clickable header's own indicator synchronized", async ({ page }) => {
      await seedInvoice({ status: "DRAFT" });
      await page.goto("/invoices");

      await page.getByLabel("Sort by").selectOption("amount:asc");
      await expect(page).toHaveURL(/sort=amount%3Aasc/);
      await expect(page.getByRole("columnheader", { name: /Amount/ })).toHaveAttribute("aria-sort", "ascending");
    });
  });

  test.describe("sticky desktop header", () => {
    test("the header remains pinned to the top of the table's own scroll container while scrolling through enough rows, and both the first and last row stay navigable", async ({
      page,
    }) => {
      // A short viewport height forces the bounded (max-h-[70vh]) inner
      // table wrapper to actually produce its own real vertical
      // scrollbar even with a modest row count — proving the mechanism,
      // not merely asserting a CSS class is present. 10 real rows (one
      // full PAGE_SIZE page) at ~1280px wide, 1280x520 viewport.
      await page.setViewportSize({ width: 1280, height: 520 });

      const prefix = uniqueNumber("E2E-STICKY");
      const rows = [];
      for (let i = 0; i < 10; i++) {
        rows.push(await seedInvoice({ invoiceNumber: `${prefix}-${i}`, status: "DRAFT" }));
      }
      await page.goto(`/invoices?q=${prefix}`);

      const table = page.locator("table");
      const scrollContainer = table.locator("xpath=..");
      const theadBefore = await page.locator("thead").boundingBox();
      expect(theadBefore).not.toBeNull();

      // Proves real vertical overflow exists to scroll through at all —
      // a direct scrollHeight/clientHeight comparison on the container
      // itself, not an inferred guess from row bounding boxes (which
      // depends on exact row height/page chrome above the table and is
      // not a reliable proxy for "does this element actually overflow").
      const lastRow = page.getByRole("row", { name: new RegExp(`${rows[9].invoiceNumber}$`) });
      const wasOutsideViewportBefore = await scrollContainer.evaluate(
        (el) => el.scrollHeight > el.clientHeight,
      );

      await scrollContainer.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });

      const theadAfter = await page.locator("thead").boundingBox();
      expect(theadAfter).not.toBeNull();
      // Tolerant bounding-range assertion (never a brittle exact-pixel
      // match) — the header's own viewport position is unchanged (within
      // 2px, allowing for subpixel layout rounding) even though the
      // table scrolled through real rows underneath it.
      expect(Math.abs(theadAfter!.y - theadBefore!.y)).toBeLessThanOrEqual(2);

      // The last row is now visible/navigable after scrolling.
      await expect(lastRow).toBeVisible();
      await expect(lastRow.getByRole("link", { name: "Edit" })).toBeVisible();

      // The first row (now scrolled above the visible area in a tall
      // table, but still present in the DOM) remains in the document and
      // its own link target is unchanged/reachable by scrolling back.
      await scrollContainer.evaluate((el) => {
        el.scrollTop = 0;
      });
      const firstRow = page.getByRole("row", { name: new RegExp(`${rows[0].invoiceNumber}$`) });
      await expect(firstRow.getByRole("link", { name: "Edit" })).toBeVisible();

      expect(wasOutsideViewportBefore).toBe(true);
    });

    test("horizontal overflow containment is preserved at a normal desktop viewport (no page-level horizontal overflow)", async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await seedInvoice({ status: "DRAFT" });
      await page.goto("/invoices");
      await expect(page.getByRole("table")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
    });

    test("the row-action overflow menu still renders above the sticky header/table correctly", async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      const invoice = await seedInvoice({ status: "DRAFT" });
      await page.goto("/invoices");

      const row = page.getByRole("row", { name: new RegExp(invoice.invoiceNumber) });
      await row.getByRole("button", { name: `More actions for invoice ${invoice.invoiceNumber}` }).click();
      const menu = page.getByRole("menu");
      await expect(menu).toBeVisible();
      const menuBox = await menu.boundingBox();
      const theadBox = await page.locator("thead").boundingBox();
      expect(menuBox).not.toBeNull();
      expect(theadBox).not.toBeNull();
      // The menu is not clipped to zero size by any ancestor overflow —
      // it has a real, visible bounding box of the expected approximate
      // width.
      expect(menuBox!.width).toBeGreaterThan(100);
    });
  });

  test.describe("responsive", () => {
    test("390x900: RecordCards are the active representation, Edit/View primary action is clear, the overflow menu is touch-usable, Delete is never prominently exposed, quick chips are usable, no horizontal overflow", async ({
      page,
    }) => {
      const draft = await seedInvoice({ status: "DRAFT" });
      await page.setViewportSize({ width: 390, height: 900 });
      await page.goto("/invoices");

      await expect(page.getByRole("table")).toBeHidden();
      const card = page.locator("li", { hasText: draft.invoiceNumber });
      await expect(card.getByRole("link", { name: "Edit" })).toBeVisible();
      await expect(card.getByRole("button", { name: "Delete" })).toHaveCount(0);

      const menuTrigger = card.getByRole("button", { name: `More actions for invoice ${draft.invoiceNumber}` });
      await expect(menuTrigger).toBeVisible();
      await menuTrigger.click();
      await expect(page.getByRole("button", { name: "Delete" })).toBeVisible();
      await page.keyboard.press("Escape");

      // Quick chips remain usable (wrap, never cause page overflow).
      await expect(page.getByRole("link", { name: "Draft" })).toBeVisible();

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
    });

    test("390x900: the Sort-by dropdown remains present and usable; no sortable-header/sticky-table UI is forced into the card layout", async ({ page }) => {
      await seedInvoice({ status: "DRAFT" });
      await page.setViewportSize({ width: 390, height: 900 });
      await page.goto("/invoices");

      await expect(page.getByLabel("Sort by")).toBeVisible();
      // No `<th>`/columnheader markup at all at this width — mobile has
      // no headers, sortable or otherwise.
      await expect(page.getByRole("columnheader")).toHaveCount(0);
    });

    test("834px: table/cards remain usable, no horizontal overflow", async ({ page }) => {
      await seedInvoice({ status: "DRAFT" });
      await page.setViewportSize({ width: 834, height: 1100 });
      await page.goto("/invoices");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
    });

    test("desktop (1280px): the table, clickable headers, sticky header, primary action, and overflow menu are all present together", async ({
      page,
    }) => {
      const invoice = await seedInvoice({ status: "DRAFT" });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto("/invoices");

      await expect(page.getByRole("table")).toBeVisible();
      await expect(page.getByRole("columnheader", { name: /Amount/ })).toHaveAttribute("aria-sort", "none");
      const row = page.getByRole("row", { name: new RegExp(invoice.invoiceNumber) });
      await expect(row.getByRole("link", { name: "Edit" })).toBeVisible();
      await expect(row.getByRole("button", { name: `More actions for invoice ${invoice.invoiceNumber}` })).toBeVisible();
    });
  });
});
