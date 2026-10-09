import { test, expect, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Tables Improvement Slice B (Contracts pilot) — real browser coverage
 * for the four new workflow-oriented behaviors reused from Invoice's
 * own Slice A: the overflow action menu (Archive/Restore relocation),
 * the clickable Issue-date sortable header, quick-filter chips, and the
 * browser-proven sticky desktop header. Domain-layer correctness
 * (tenant scoping, lifecycle semantics, archive/restore idempotency) is
 * already exhaustively covered elsewhere (test/e2e/contracts.spec.ts,
 * this slice's own unit tests) and is not re-derived here.
 */

let fixtures: TestFixtures;
let seededContractIds: string[] = [];

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

async function seedContract(overrides: Record<string, unknown>): Promise<{ id: string; contractNumber: string }> {
  const contractNumber = (overrides.contractNumber as string) ?? uniqueNumber("E2E-TBL-C");
  const created = await dbQuery<{ id: string; contractNumber: string }>("contract", "create", {
    data: {
      title: "Workflow Slice B Test Contract",
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

test.describe("Contract table workflow (Tables Improvement Slice B)", () => {
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

  test.describe("action menu", () => {
    test("active DRAFT: direct Edit visible, no direct Archive, Archive behind the overflow menu, existing confirmation preserved, Cancel leaves the contract unchanged", async ({ page }) => {
      const contract = await seedContract({ status: "DRAFT" });
      await page.goto("/contracts");

      const row = page.getByRole("row", { name: new RegExp(contract.contractNumber) });
      await expect(row.getByRole("link", { name: "Edit" })).toBeVisible();
      await expect(row.getByRole("link", { name: "View" })).toHaveCount(0);
      await expect(row.getByRole("button", { name: "Archive" })).toHaveCount(0);

      const menuTrigger = row.getByRole("button", { name: `More actions for contract ${contract.contractNumber}` });
      await expect(menuTrigger).toBeVisible();
      await menuTrigger.click();

      const archiveButton = page.getByRole("button", { name: "Archive" });
      await expect(archiveButton).toBeVisible();
      await expect(page.getByRole("button", { name: "Restore" })).toHaveCount(0);

      await archiveButton.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("Archive contract");

      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toBeHidden();
      await page.reload();
      const reloadedRow = page.getByRole("row", { name: new RegExp(contract.contractNumber) });
      await expect(reloadedRow.getByRole("link", { name: "Edit" })).toBeVisible();
    });

    test("confirming Archive through the overflow menu actually archives the contract (existing server action, unmodified)", async ({ page }) => {
      const contract = await seedContract({ status: "DRAFT" });
      await page.goto("/contracts");

      const row = page.getByRole("row", { name: new RegExp(contract.contractNumber) });
      await row.getByRole("button", { name: `More actions for contract ${contract.contractNumber}` }).click();
      await page.getByRole("button", { name: "Archive" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Archive" }).click();

      await expect(page.getByText("Contract archived")).toBeVisible();
      await expect(page.getByRole("row", { name: new RegExp(contract.contractNumber) })).toHaveCount(0);
    });

    test("active non-DRAFT (SENT): direct View visible, no Edit, no empty overflow — Archive present in the menu", async ({ page }) => {
      const contract = await seedContract({ status: "SENT" });
      await page.goto("/contracts");

      const row = page.getByRole("row", { name: new RegExp(contract.contractNumber) });
      await expect(row.getByRole("link", { name: "View" })).toBeVisible();
      await expect(row.getByRole("link", { name: "Edit" })).toHaveCount(0);

      await row.getByRole("button", { name: `More actions for contract ${contract.contractNumber}` }).click();
      await expect(page.getByRole("button", { name: "Archive" })).toBeVisible();
      // No lifecycle row controls of any kind.
      await expect(page.getByRole("button", { name: "Send contract" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Record acceptance" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Terminate contract" })).toHaveCount(0);
    });

    test("archived contract: direct View visible, Restore present in the menu, no Archive option", async ({ page }) => {
      const contract = await seedContract({ status: "ACCEPTED", archivedAt: new Date().toISOString() });
      await page.goto("/contracts?archived=1");

      const row = page.getByRole("row", { name: new RegExp(contract.contractNumber) });
      await expect(row.getByRole("link", { name: "View" })).toBeVisible();
      await expect(row.getByRole("link", { name: "Edit" })).toHaveCount(0);

      await row.getByRole("button", { name: `More actions for contract ${contract.contractNumber}` }).click();
      await expect(page.getByRole("button", { name: "Restore" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Archive" })).toHaveCount(0);
    });

    test("Escape closes the open menu and returns focus to the trigger", async ({ page }) => {
      const contract = await seedContract({ status: "DRAFT" });
      await page.goto("/contracts");

      const row = page.getByRole("row", { name: new RegExp(contract.contractNumber) });
      const menuTrigger = row.getByRole("button", { name: `More actions for contract ${contract.contractNumber}` });
      await menuTrigger.click();
      await expect(page.getByRole("menu")).toBeVisible();

      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0);
      await expect(menuTrigger).toBeFocused();
    });
  });

  test.describe("quick-filter chips", () => {
    test("Draft chip filters to DRAFT persisted-status rows only, is visually active, and clicking it again clears the filter", async ({ page }) => {
      const draft = await seedContract({ status: "DRAFT" });
      const sent = await seedContract({ status: "SENT" });
      await page.goto("/contracts");

      const chip = page.getByRole("link", { name: "Draft" });
      await chip.click();
      await expect(page).toHaveURL(/status=DRAFT/);
      await expect(chip).toHaveAttribute("aria-current", "true");
      await expect(page.getByRole("row", { name: new RegExp(draft.contractNumber) })).toBeVisible();
      await expect(page.getByRole("row", { name: new RegExp(sent.contractNumber) })).toHaveCount(0);
      await expect(page.getByLabel("Status").first()).toHaveValue("DRAFT");

      await page.getByRole("link", { name: "Draft" }).click();
      await expect(page).not.toHaveURL(/status=DRAFT/);
      await expect(page.getByRole("row", { name: new RegExp(sent.contractNumber) })).toBeVisible();
    });

    test("Terminated is never a quick chip — only reachable via the Status dropdown, and selecting it leaves no chip active", async ({ page }) => {
      await seedContract({ status: "TERMINATED" });
      await page.goto("/contracts");

      await expect(page.getByRole("link", { name: "Terminated" })).toHaveCount(0);
      await page.getByLabel("Status").first().selectOption("TERMINATED");
      await page.locator("form").getByRole("button", { name: "Search" }).click();
      await expect(page).toHaveURL(/status=TERMINATED/);
      await expect(page.getByRole("link", { name: "Draft" })).not.toHaveAttribute("aria-current", "true");
      await expect(page.getByRole("link", { name: "Sent" })).not.toHaveAttribute("aria-current", "true");
      await expect(page.getByRole("link", { name: "Accepted", exact: true })).not.toHaveAttribute("aria-current", "true");
    });

    test("Accepted chip includes a persisted-ACCEPTED, date-expired contract — it still displays the Expired badge, proving filter and display are orthogonal", async ({ page }) => {
      const expired = await seedContract({
        status: "ACCEPTED",
        expiresAt: "2020-01-01T00:00:00.000Z",
        contractNumber: uniqueNumber("E2E-TBL-EXPIRED"),
      });
      await page.goto("/contracts");

      await page.getByRole("link", { name: "Accepted", exact: true }).click();
      await expect(page).toHaveURL(/status=ACCEPTED/);
      const row = page.getByRole("row", { name: new RegExp(expired.contractNumber) });
      await expect(row).toBeVisible();
      await expect(row.getByText("Expired", { exact: true })).toBeVisible();
    });

    test("there is no Expired quick-filter chip anywhere on the page", async ({ page }) => {
      await seedContract({ status: "ACCEPTED" });
      await page.goto("/contracts");
      await expect(page.getByRole("link", { name: "Expired" })).toHaveCount(0);
    });
  });

  test.describe("sortable headers", () => {
    test("Issue date: clicking sorts ascending first, toggles to descending on a second click, and the Sort-by dropdown reflects the same state", async ({ page }) => {
      const earlier = await seedContract({ issueDate: "2026-01-10T00:00:00.000Z", contractNumber: uniqueNumber("E2E-SORT-EARLY") });
      const later = await seedContract({ issueDate: "2026-06-10T00:00:00.000Z", contractNumber: uniqueNumber("E2E-SORT-LATE") });
      await page.goto("/contracts?q=E2E-SORT");

      const header = page.getByRole("columnheader", { name: /Issue date/ });
      await header.getByRole("link").click();
      await expect(page).toHaveURL(/sort=issueDate%3Aasc/);
      await expect(page.getByRole("columnheader", { name: /Issue date/ })).toHaveAttribute("aria-sort", "ascending");
      await expect(page.getByLabel("Sort by")).toHaveValue("issueDate:asc");

      const rowsAsc = await page.getByRole("row").allTextContents();
      expect(rowsAsc.findIndex((t) => t.includes(earlier.contractNumber))).toBeLessThan(
        rowsAsc.findIndex((t) => t.includes(later.contractNumber)),
      );

      await page.getByRole("columnheader", { name: /Issue date/ }).getByRole("link").click();
      await expect(page).toHaveURL(/sort=issueDate%3Adesc/);
      await expect(page.getByRole("columnheader", { name: /Issue date/ })).toHaveAttribute("aria-sort", "descending");
      await expect(page.getByLabel("Sort by")).toHaveValue("issueDate:desc");

      const rowsDesc = await page.getByRole("row").allTextContents();
      expect(rowsDesc.findIndex((t) => t.includes(later.contractNumber))).toBeLessThan(
        rowsDesc.findIndex((t) => t.includes(earlier.contractNumber)),
      );
    });

    test("with no sort param, the Sort-by dropdown shows 'Default order' and the header shows aria-sort=none", async ({ page }) => {
      await seedContract({ status: "DRAFT" });
      await page.goto("/contracts");
      await expect(page.getByRole("columnheader", { name: /Issue date/ })).toHaveAttribute("aria-sort", "none");
      await expect(page.getByLabel("Sort by")).toHaveValue("");
    });

    test("the Sort-by dropdown still fully works and keeps the clickable header's own indicator synchronized", async ({ page }) => {
      await seedContract({ status: "DRAFT" });
      await page.goto("/contracts");

      await page.getByLabel("Sort by").selectOption("issueDate:desc");
      await expect(page).toHaveURL(/sort=issueDate%3Adesc/);
      await expect(page.getByRole("columnheader", { name: /Issue date/ })).toHaveAttribute("aria-sort", "descending");
    });
  });

  test.describe("sticky desktop header", () => {
    test("the header remains pinned to the top of the table's own scroll container while scrolling through enough rows", async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 520 });

      const prefix = uniqueNumber("E2E-STICKY-C");
      const rows = [];
      for (let i = 0; i < 10; i++) {
        rows.push(await seedContract({ contractNumber: `${prefix}-${i}`, status: "DRAFT" }));
      }
      await page.goto(`/contracts?q=${prefix}`);

      const table = page.locator("table");
      const scrollContainer = table.locator("xpath=..");
      const theadBefore = await page.locator("thead").boundingBox();
      expect(theadBefore).not.toBeNull();

      const lastRow = page.getByRole("row", { name: new RegExp(`${rows[9].contractNumber}$`) });
      const wasOutsideViewportBefore = await scrollContainer.evaluate((el) => el.scrollHeight > el.clientHeight);

      await scrollContainer.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });

      const theadAfter = await page.locator("thead").boundingBox();
      expect(theadAfter).not.toBeNull();
      expect(Math.abs(theadAfter!.y - theadBefore!.y)).toBeLessThanOrEqual(2);

      await expect(lastRow).toBeVisible();
      await expect(lastRow.getByRole("link", { name: "Edit" })).toBeVisible();

      await scrollContainer.evaluate((el) => {
        el.scrollTop = 0;
      });
      const firstRow = page.getByRole("row", { name: new RegExp(`${rows[0].contractNumber}$`) });
      await expect(firstRow.getByRole("link", { name: "Edit" })).toBeVisible();

      expect(wasOutsideViewportBefore).toBe(true);
    });

    test("horizontal overflow containment is preserved at a normal desktop viewport", async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await seedContract({ status: "DRAFT" });
      await page.goto("/contracts");
      await expect(page.getByRole("table")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
    });

    test("the row-action overflow menu still renders above the sticky header/table correctly", async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      const contract = await seedContract({ status: "DRAFT" });
      await page.goto("/contracts");

      const row = page.getByRole("row", { name: new RegExp(contract.contractNumber) });
      await row.getByRole("button", { name: `More actions for contract ${contract.contractNumber}` }).click();
      const menu = page.getByRole("menu");
      await expect(menu).toBeVisible();
      const menuBox = await menu.boundingBox();
      expect(menuBox).not.toBeNull();
      expect(menuBox!.width).toBeGreaterThan(100);
    });
  });

  test.describe("responsive", () => {
    test("390x900: RecordCards are the active representation, DRAFT Edit + overflow Archive, chips/sort usable, no horizontal overflow", async ({
      page,
    }) => {
      const draft = await seedContract({ status: "DRAFT" });
      await page.setViewportSize({ width: 390, height: 900 });
      await page.goto("/contracts");

      await expect(page.getByRole("table")).toBeHidden();
      const card = page.locator("li", { hasText: draft.contractNumber });
      await expect(card.getByRole("link", { name: "Edit" })).toBeVisible();

      const menuTrigger = card.getByRole("button", { name: `More actions for contract ${draft.contractNumber}` });
      await expect(menuTrigger).toBeVisible();
      await menuTrigger.click();
      await expect(page.getByRole("button", { name: "Archive" })).toBeVisible();
      await page.keyboard.press("Escape");

      await expect(page.getByRole("link", { name: "Draft" })).toBeVisible();
      await expect(page.getByLabel("Sort by")).toBeVisible();
      await expect(page.getByRole("columnheader")).toHaveCount(0);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
    });

    test("834px: table/cards remain usable, no horizontal overflow", async ({ page }) => {
      await seedContract({ status: "DRAFT" });
      await page.setViewportSize({ width: 834, height: 1100 });
      await page.goto("/contracts");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
    });

    test("desktop (1280px): the table, clickable header, sticky header, primary action, and overflow menu are all present together", async ({
      page,
    }) => {
      const contract = await seedContract({ status: "DRAFT" });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto("/contracts");

      await expect(page.getByRole("table")).toBeVisible();
      await expect(page.getByRole("columnheader", { name: /Issue date/ })).toHaveAttribute("aria-sort", "none");
      const row = page.getByRole("row", { name: new RegExp(contract.contractNumber) });
      await expect(row.getByRole("link", { name: "Edit" })).toBeVisible();
      await expect(row.getByRole("button", { name: `More actions for contract ${contract.contractNumber}` })).toBeVisible();
    });
  });

  test.describe("hydration safety", () => {
    test("first-ever load of /contracts in a fresh browser context produces no React hydration mismatch, and the Issue date cell actually renders", async ({ page }) => {
      // Listener registration MUST precede the first navigation -- a
      // prior investigation attached listeners only around a SECOND
      // navigation (a reload() following an already-uncaptured first
      // goto), which never observed the real defect: a genuine SSR vs
      // first-client-paint divergence on `ContractListWithSelection`'s
      // own `issueDate` text, present on literally the first load,
      // completely independent of Saved Views/localStorage (confirmed
      // by the dedicated read-only audit that root-caused this). Every
      // other Contract E2E test in this file navigates AFTER its own
      // `beforeEach`'s `actAsOwner` call with no prior page load in the
      // same browser context, so this is already each test's own first
      // navigation -- this test just makes that property, and the
      // absence of a hydration error on it, an explicit assertion.
      const contract = await seedContract({
        status: "DRAFT",
        issueDate: "2026-06-01T00:00:00.000Z",
        contractNumber: uniqueNumber("E2E-HYDRATION"),
      });
      await page.setViewportSize({ width: 1280, height: 900 });

      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));

      await page.goto("/contracts");

      const row = page.getByRole("row", { name: new RegExp(contract.contractNumber) });
      await expect(row).toBeVisible();
      // The row's own Issue date cell actually rendered real text (not
      // just "no error" -- proves the regression isn't vacuously
      // passing because the date cell silently failed to render at all).
      await expect(row.getByRole("cell").filter({ hasText: "2026" })).toHaveCount(1);

      const hydrationRelated = [...consoleErrors, ...pageErrors].filter((text) =>
        /hydrat|#418|did not match|server-rendered/i.test(text),
      );
      expect(hydrationRelated).toEqual([]);
      expect(pageErrors).toEqual([]);
    });

    test("SSR raw HTML and the hydrated DOM render the exact same Issue date text for the same Contract", async ({ page, request, baseURL }) => {
      const contract = await seedContract({
        status: "DRAFT",
        issueDate: "2026-06-01T00:00:00.000Z",
        contractNumber: uniqueNumber("E2E-HYDRATION-SSR"),
      });
      await page.setViewportSize({ width: 1280, height: 900 });

      // Raw SSR HTML for this exact authenticated request, bypassing all
      // client JS entirely -- the only way to observe what the server
      // itself actually sent, independent of whatever the browser does
      // with it afterward.
      const cookies = await page.context().cookies();
      const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
      const ssrResponse = await request.get(`${baseURL}/contracts`, { headers: { cookie: cookieHeader } });
      const ssrHtml = await ssrResponse.text();

      await page.goto("/contracts");
      const row = page.getByRole("row", { name: new RegExp(contract.contractNumber) });
      await expect(row).toBeVisible();
      const hydratedDateCell = await row.getByRole("cell").filter({ hasText: "2026" }).first().textContent();

      // The server's own raw response must already contain the exact
      // same date text the browser ends up showing -- not merely "no
      // console error", but genuine byte-for-byte equality of the one
      // value this defect class made diverge.
      expect(hydratedDateCell?.trim()).toBe("6/1/2026");
      expect(ssrHtml).toContain(">6/1/2026<");
    });
  });
});
