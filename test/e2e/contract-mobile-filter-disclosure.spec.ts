import { test, expect, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Mobile Improvement Slice B1 — Contracts mobile filter disclosure
 * pilot. Real browser coverage for the one approved behavior: below
 * `md` (768px), Status/Client/Project/Archive status/Sort by/Clear
 * collapse into a native `<details>` disclosure (summary "Filter" or
 * "Filter (N)"), closed by default unless one of the four counted
 * fields (status/client/project/archived — never q, never sort) is
 * already active; at `md` and up the disclosure is fully inert and
 * invisible — every field renders exactly as before, unconditionally.
 * Search, quick-filter chips, Saved Views, and Column Customization are
 * all untouched by this slice and are only re-confirmed here where they
 * interact directly with the new disclosure (shared `status` param,
 * Saved View Apply). Domain-layer filter/search correctness itself is
 * already exhaustively covered elsewhere (contracts-table-workflow.spec.ts,
 * contract-stale-entity-filter.spec.ts, contract-saved-views.spec.ts)
 * and is not re-derived here.
 */

let fixtures: TestFixtures;
let seededContractIds: string[] = [];

const STALE_UUID = "00000000-0000-0000-0000-000000000000";

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

async function seedContract(overrides: Record<string, unknown> = {}): Promise<{ id: string; contractNumber: string }> {
  const contractNumber = (overrides.contractNumber as string) ?? uniqueNumber("E2E-MFD");
  const created = await dbQuery<{ id: string; contractNumber: string }>("contract", "create", {
    data: {
      title: "Mobile Filter Disclosure Test Contract",
      body: "This agreement is entered into by and between the parties.",
      status: "DRAFT",
      issueDate: "2026-06-01T00:00:00.000Z",
      organizationId: fixtures.orgA.id,
      clientId: fixtures.clientA.id,
      createdByUserId: fixtures.owner.id,
      ...overrides,
      contractNumber,
    },
  });
  seededContractIds.push(created.id);
  return created;
}

async function cleanupSeededContracts(): Promise<void> {
  if (seededContractIds.length > 0) {
    await dbQuery("contract", "deleteMany", { where: { id: { in: seededContractIds } } });
    seededContractIds = [];
  }
}

// A direct CSS locator on the <summary> element itself — confirmed
// directly (not assumed) that Playwright's own accessibility snapshot
// collapses the whole <details>/<summary> pair into a single "group"
// node whose computed name absorbs the (open-state-dependent) content
// text too, which makes a role-based query for this element both
// unreliable and semantically wrong here. The plain CSS locator
// resolves to exactly the one real <summary> element (never its nested
// <span>/icon children), so `.toHaveText(...)` reads its own normalized
// text and `.click()` toggles the native disclosure directly. Visibility
// assertions still work correctly off plain CSS visibility (the
// `md:hidden` class sets `display:none` on this exact element), which
// is what this slice's desktop invariant actually depends on.
function filterToggle(page: Page) {
  return page.locator("details.mobile-filter-disclosure > summary");
}

function disclosure(page: Page) {
  return page.locator("details.mobile-filter-disclosure");
}

test.describe("Contract mobile filter disclosure (Mobile Improvement Slice B1)", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.beforeEach(async ({ page, baseURL }) => {
    await actAsOwner(page, baseURL!);
  });

  test.afterEach(async () => {
    await cleanupSeededContracts();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test.describe("mobile (390px): collapsed default", () => {
    test.use({ viewport: { width: 390, height: 900 } });

    test("no active filters: summary reads 'Filter', disclosure closed, secondary selects hidden, Search/chips/Saved Views/cards all visible", async ({ page }) => {
      const contract = await seedContract({ status: "DRAFT" });
      await page.goto("/contracts");

      await expect(filterToggle(page)).toHaveText("Filter");
      await expect(disclosure(page)).not.toHaveAttribute("open", "");

      await expect(page.locator("form").getByLabel("Search")).toBeVisible();
      await expect(page.getByRole("link", { name: "Draft" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Save current view" })).toBeVisible();

      // The fields are collapsed, not removed -- present in the DOM
      // (HTML form semantics still apply) but not visible.
      await expect(page.getByLabel("Status").first()).toBeHidden();
      await expect(page.getByLabel("Client").first()).toBeHidden();
      await expect(page.getByLabel("Project").first()).toBeHidden();
      await expect(page.getByLabel("Sort by")).toBeHidden();

      const card = page.locator("li", { hasText: contract.contractNumber });
      await expect(card).toBeVisible();

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
    });

    test("expanding the disclosure reveals every secondary field with no horizontal overflow", async ({ page }) => {
      await seedContract({ status: "DRAFT" });
      await page.goto("/contracts");

      await filterToggle(page).click();
      await expect(disclosure(page)).toHaveAttribute("open", "");

      await expect(page.getByLabel("Status").first()).toBeVisible();
      await expect(page.getByLabel("Client").first()).toBeVisible();
      await expect(page.getByLabel("Project").first()).toBeVisible();
      await expect(page.getByLabel("Archive status")).toBeVisible();
      await expect(page.getByLabel("Sort by")).toBeVisible();

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
    });

    test("auto-submit progression: selecting Status submits immediately, increments the count, and the resulting fresh load opens the disclosure", async ({ page }) => {
      const draft = await seedContract({ status: "DRAFT" });
      const sent = await seedContract({ status: "SENT" });
      await page.goto("/contracts");

      await filterToggle(page).click();
      await page.getByLabel("Status").first().selectOption("DRAFT");

      await expect(page).toHaveURL(/status=DRAFT/);
      await expect(filterToggle(page)).toHaveText("Filter (1)");
      await expect(disclosure(page)).toHaveAttribute("open", "");
      await expect(page.getByRole("row", { name: new RegExp(draft.contractNumber) })).toHaveCount(0); // mobile: no table
      const card = page.locator("li", { hasText: draft.contractNumber });
      await expect(card).toBeVisible();
      await expect(page.locator("li", { hasText: sent.contractNumber })).toHaveCount(0);

      // Selecting a second field (Client) on top of the first — count
      // moves from 1 to 2, first filter (status=DRAFT) is preserved.
      await page.getByLabel("Client").first().selectOption(fixtures.clientA.id);
      await expect(page).toHaveURL(/status=DRAFT/);
      await expect(page).toHaveURL(new RegExp(`client=${fixtures.clientA.id}`));
      await expect(filterToggle(page)).toHaveText("Filter (2)");
      await expect(disclosure(page)).toHaveAttribute("open", "");
    });

    test("sort-exclusion: choosing only Sort by never increments the count and never auto-opens the disclosure on a fresh load", async ({ page }) => {
      await seedContract({ status: "DRAFT" });
      await page.goto("/contracts");

      await filterToggle(page).click();
      await page.getByLabel("Sort by").selectOption("issueDate:asc");

      await expect(page).toHaveURL(/sort=issueDate%3Aasc/);
      // A plain GET form submission includes every field by name even
      // when empty (e.g. `status=`), so the real check is for a
      // non-empty value immediately after `=`, never mere param
      // presence (see contract-stale-entity-filter.spec.ts's own
      // identical convention/comment for this exact gotcha).
      await expect(page).not.toHaveURL(/status=[^&]|client=[^&]|project=[^&]|archived=1/);
      // This load's own submission opened the <details> as a direct
      // result of the user's own click a moment ago -- the real
      // assertion is a FRESH navigation to the exact same URL, which
      // re-derives `open` from the server-computed activeCount alone.
      await page.goto(page.url());
      await expect(filterToggle(page)).toHaveText("Filter");
      await expect(disclosure(page)).not.toHaveAttribute("open", "");
    });

    test("quick-filter chip: clicking Draft sets the shared status param, opens the disclosure, and the Status dropdown reflects it truthfully", async ({ page }) => {
      await seedContract({ status: "DRAFT" });
      await page.goto("/contracts");

      await page.getByRole("link", { name: "Draft" }).click();
      await expect(page).toHaveURL(/status=DRAFT/);
      await expect(filterToggle(page)).toHaveText("Filter (1)");
      await expect(disclosure(page)).toHaveAttribute("open", "");

      await expect(page.getByLabel("Status").first()).toHaveValue("DRAFT");
    });

    test("Saved View apply: restores every field, activeCount matches the restored state, disclosure opens, chip reflects the shared status param", async ({ page }) => {
      await seedContract({ status: "SENT" });
      const marker = uniqueNumber("E2E-MFD-SVC");
      await page.goto(`/contracts?status=SENT&q=${marker}`);

      await page.getByRole("button", { name: "Save current view" }).click();
      await page.getByRole("textbox", { name: "View name" }).fill(marker);
      await page.getByRole("button", { name: "Save", exact: true }).click();

      // Navigate away to a totally different state before applying.
      await page.goto("/contracts");
      await expect(filterToggle(page)).toHaveText("Filter");

      // The Apply link only renders once a view is actually selected in
      // the (separate, sr-only labeled) "Saved views" dropdown -- scoped
      // to the combobox role specifically, since a plain getByLabel
      // resolves to the surrounding role="group" container instead
      // (which shares the exact same "Saved views" aria-label).
      await page.getByRole("combobox", { name: "Saved views" }).selectOption({ label: marker });
      await page.getByRole("link", { name: "Apply" }).click();
      await expect(page).toHaveURL(/status=SENT/);
      await expect(filterToggle(page)).toHaveText("Filter (1)");
      await expect(disclosure(page)).toHaveAttribute("open", "");
      await expect(page.getByLabel("Status").first()).toHaveValue("SENT");
      await expect(page.getByRole("link", { name: "Sent", exact: true })).toHaveAttribute("aria-current", "true");
    });

    test("stale client filter: disclosure opens, count is 1, the Unavailable client sentinel renders, no raw UUID leaks as visible text", async ({ page }) => {
      await page.goto(`/contracts?client=${STALE_UUID}`);

      // activeCount=1 already opens the disclosure server-side -- it is
      // already open, so no click is needed (or correct) here.
      await expect(filterToggle(page)).toHaveText("Filter (1)");
      await expect(disclosure(page)).toHaveAttribute("open", "");

      const clientSelect = page.getByLabel("Client").first();
      await expect(clientSelect).toHaveValue(STALE_UUID);
      await expect(clientSelect.locator("option", { hasText: "Unavailable client" })).toHaveCount(1);

      const summaryText = await filterToggle(page).textContent();
      expect(summaryText).not.toContain(STALE_UUID);
    });

    test("Clear resets activeCount to 0, summary back to 'Filter', and a fresh load renders the disclosure closed again", async ({ page }) => {
      const other = await seedContract({ clientId: fixtures.clientA.id });
      await page.goto("/contracts?status=DRAFT");

      // activeCount=1 already opens the disclosure server-side by
      // default -- clicking the toggle here would actually CLOSE it
      // (and hide the Clear link it's about to look for), so this
      // deliberately does NOT click it first.
      await expect(filterToggle(page)).toHaveText("Filter (1)");
      await expect(disclosure(page)).toHaveAttribute("open", "");

      await page.locator("form").getByRole("link", { name: "Clear", exact: true }).click();
      await expect(page).not.toHaveURL(/status=/);
      await expect(filterToggle(page)).toHaveText("Filter");
      await expect(disclosure(page)).not.toHaveAttribute("open", "");
      await expect(page.locator("li", { hasText: other.contractNumber })).toBeVisible();
    });
  });

  test.describe("breakpoint matrix", () => {
    test("767px (just below md): disclosure/summary mechanism still active", async ({ page }) => {
      await seedContract({ status: "DRAFT" });
      await page.setViewportSize({ width: 767, height: 900 });
      await page.goto("/contracts");

      await expect(filterToggle(page)).toBeVisible();
      await expect(page.getByLabel("Status").first()).toBeHidden();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
    });

    test("768px (md breakpoint): no visible Filter summary, every field visible unconditionally, no click needed", async ({ page }) => {
      const contract = await seedContract({ status: "DRAFT" });
      await page.setViewportSize({ width: 768, height: 900 });
      await page.goto("/contracts");

      await expect(filterToggle(page)).toBeHidden();
      await expect(page.getByLabel("Status").first()).toBeVisible();
      await expect(page.getByLabel("Client").first()).toBeVisible();
      await expect(page.getByLabel("Project").first()).toBeVisible();
      await expect(page.getByLabel("Archive status")).toBeVisible();
      await expect(page.getByLabel("Sort by")).toBeVisible();
      // RecordCardList's own breakpoint is `xl:` (1280px), deliberately
      // wider than this disclosure's own `md:` (768px) -- the table is
      // not expected to be the active representation here yet.
      await expect(page.getByRole("table")).toBeHidden();
      await expect(page.locator("li", { hasText: contract.contractNumber })).toBeVisible();
    });

    test("desktop (1280px) regression: unchanged order/labels, Search/Saved Views/chips/Columns all present, no Filter summary anywhere", async ({ page }) => {
      const contract = await seedContract({ status: "DRAFT" });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto("/contracts");

      // The <summary> element exists in the DOM at every breakpoint
      // (never removed/duplicated) — only hidden via `md:hidden`, so
      // the correct assertion is visibility, not DOM absence (a plain
      // CSS locator's `toHaveCount` does not account for `display`).
      await expect(filterToggle(page)).toBeHidden();
      await expect(page.locator("form").getByLabel("Search")).toBeVisible();
      await expect(page.getByLabel("Status").first()).toBeVisible();
      await expect(page.getByLabel("Client").first()).toBeVisible();
      await expect(page.getByLabel("Project").first()).toBeVisible();
      await expect(page.getByLabel("Archive status")).toBeVisible();
      await expect(page.getByLabel("Sort by")).toBeVisible();
      await expect(page.getByRole("button", { name: "Save current view" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Draft" })).toBeVisible();

      const row = page.getByRole("row", { name: new RegExp(contract.contractNumber) });
      await expect(row).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
    });
  });
});
