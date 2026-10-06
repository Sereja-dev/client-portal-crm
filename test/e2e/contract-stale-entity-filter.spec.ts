import { test, expect, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Contract stale entity filter remediation — real browser coverage for
 * the approved fail-closed semantics: a syntactically valid but
 * missing/foreign-org `?client=`/`?project=` UUID remains fully active
 * in the canonical URL and the existing org-scoped Contract query
 * (zero-result semantics preserved, confirmed safe in the prior
 * read-only audit), while the Client/Project `<select>` now renders a
 * truthful "Unavailable client"/"Unavailable project" sentinel instead
 * of silently falling back to "All clients"/"All projects". Domain-
 * layer tenant scoping is already exhaustively covered elsewhere
 * (contracts.spec.ts, test/integration/contracts/*); this file only
 * proves the UI is now truthful about an already-safe query.
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
  const contractNumber = (overrides.contractNumber as string) ?? uniqueNumber("E2E-STALEFILTER");
  const created = await dbQuery<{ id: string; contractNumber: string }>("contract", "create", {
    data: {
      title: "Stale Filter Remediation Test Contract",
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

test.describe("Contract stale entity filter remediation", () => {
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

  test("stale (nonexistent) client UUID: URL preserved, sentinel shown, live value is the stale id, zero truthful results, no raw UUID visible as a label", async ({ page }) => {
    await page.goto(`/contracts?client=${STALE_UUID}`);

    await expect(page).toHaveURL(new RegExp(`client=${STALE_UUID}`));
    const clientSelect = page.getByLabel("Client");
    await expect(clientSelect).toHaveValue(STALE_UUID);
    await expect(clientSelect.locator("option", { hasText: "Unavailable client" })).toHaveCount(1);
    await expect(page.getByText("No matching contracts")).toBeVisible();
    await expect(page.getByRole("link", { name: "Clear filters" })).toBeVisible();

    // The raw UUID is never rendered as a visible option label anywhere.
    const optionTexts = await clientSelect.locator("option").allTextContents();
    for (const text of optionTexts) {
      expect(text).not.toContain(STALE_UUID);
    }
  });

  test("stale (nonexistent) project UUID: URL preserved, sentinel shown, live value is the stale id, zero truthful results", async ({ page }) => {
    await page.goto(`/contracts?project=${STALE_UUID}`);

    await expect(page).toHaveURL(new RegExp(`project=${STALE_UUID}`));
    const projectSelect = page.getByLabel("Project");
    await expect(projectSelect).toHaveValue(STALE_UUID);
    await expect(projectSelect.locator("option", { hasText: "Unavailable project" })).toHaveCount(1);
    await expect(page.getByText("No matching contracts")).toBeVisible();
  });

  test("foreign-org client UUID: identical Unavailable client sentinel, no foreign name leaks, zero current-org rows, URL unchanged", async ({ page }) => {
    await page.goto(`/contracts?client=${fixtures.clientB.id}`);

    await expect(page).toHaveURL(new RegExp(`client=${fixtures.clientB.id}`));
    const clientSelect = page.getByLabel("Client");
    await expect(clientSelect).toHaveValue(fixtures.clientB.id);
    await expect(clientSelect.locator("option", { hasText: "Unavailable client" })).toHaveCount(1);
    await expect(page.getByText(fixtures.clientB.name)).toHaveCount(0);
    await expect(page.getByText("No matching contracts")).toBeVisible();
  });

  test("valid client filter: still renders the real Client name (no sentinel) and still narrows rows correctly", async ({ page }) => {
    const matching = await seedContract({ clientId: fixtures.clientA.id });
    await page.goto(`/contracts?client=${fixtures.clientA.id}`);

    const clientSelect = page.getByLabel("Client");
    await expect(clientSelect).toHaveValue(fixtures.clientA.id);
    await expect(clientSelect.locator("option", { hasText: "Unavailable client" })).toHaveCount(0);
    await expect(page.getByRole("row", { name: new RegExp(matching.contractNumber) })).toBeVisible();
  });

  test("valid project filter: still renders the real Project name (no sentinel) and still narrows rows correctly", async ({ page }) => {
    const matching = await seedContract({ projectId: fixtures.project.id });
    await page.goto(`/contracts?project=${fixtures.project.id}`);

    const projectSelect = page.getByLabel("Project");
    await expect(projectSelect).toHaveValue(fixtures.project.id);
    await expect(projectSelect.locator("option", { hasText: "Unavailable project" })).toHaveCount(0);
    await expect(page.getByRole("row", { name: new RegExp(matching.contractNumber) })).toBeVisible();
  });

  test("search-submit: leaving a stale Client filter untouched and submitting Search preserves the stale filter and zero-result state; explicitly choosing All clients clears it", async ({ page }) => {
    const other = await seedContract({ clientId: fixtures.clientA.id });
    await page.goto(`/contracts?client=${STALE_UUID}`);

    await page.locator("form").getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(new RegExp(`client=${STALE_UUID}`));
    await expect(page.getByLabel("Client")).toHaveValue(STALE_UUID);
    await expect(page.getByText("No matching contracts")).toBeVisible();

    // Explicitly choosing "All clients" and submitting clears the filter
    // for real — proven by the previously-hidden row becoming visible
    // (a plain GET form submission includes every field by name, e.g.
    // `client=`, even when empty, so asserting on the literal query
    // string here would be the wrong check; the row's own visibility is
    // the real proof the filter was cleared, not merely redisplayed).
    await page.getByLabel("Client").selectOption("");
    await page.locator("form").getByRole("button", { name: "Search" }).click();
    await expect(page.getByLabel("Client")).toHaveValue("");
    await expect(page.getByRole("row", { name: new RegExp(other.contractNumber) })).toBeVisible();
  });

  test("quick-filter chip click preserves a stale Client filter rather than broadening results", async ({ page }) => {
    await page.goto(`/contracts?client=${STALE_UUID}`);

    await page.getByRole("link", { name: "Draft" }).click();
    await expect(page).toHaveURL(new RegExp(`client=${STALE_UUID}`));
    await expect(page).toHaveURL(/status=DRAFT/);
    await expect(page.getByLabel("Client")).toHaveValue(STALE_UUID);
    await expect(page.getByText("No matching contracts")).toBeVisible();
  });

  test("sorting preserves a stale Project filter", async ({ page }) => {
    // The clickable Issue-date column header only exists inside the
    // non-empty-result table — and a genuinely stale project id, by
    // definition, never matches any row, so the table (and its header)
    // can never be visible at the same time as a stale project filter.
    // The Sort-by dropdown is the reachable equivalent: it renders
    // unconditionally in SearchFilterBar (same as the quick-filter
    // chips), so it's the real, exercisable path for "does changing
    // sort state via any control still preserve an already-active
    // stale filter."
    await page.goto(`/contracts?project=${STALE_UUID}`);

    await page.getByLabel("Sort by").selectOption("issueDate:asc");
    await expect(page).toHaveURL(new RegExp(`project=${STALE_UUID}`));
    await expect(page).toHaveURL(/sort=issueDate/);
    await expect(page.getByLabel("Project")).toHaveValue(STALE_UUID);
    await expect(page.getByLabel("Project").locator("option", { hasText: "Unavailable project" })).toHaveCount(1);
  });

  test("Clear removes the stale filter entirely and normal results return", async ({ page }) => {
    const other = await seedContract({ clientId: fixtures.clientA.id });
    await page.goto(`/contracts?client=${STALE_UUID}`);

    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(page).not.toHaveURL(/client=/);
    await expect(page.getByLabel("Client")).toHaveValue("");
    await expect(page.getByLabel("Client").locator("option", { hasText: "Unavailable client" })).toHaveCount(0);
    await expect(page.getByRole("row", { name: new RegExp(other.contractNumber) })).toBeVisible();
  });

  test("390px: the Unavailable client sentinel renders readably with no destructive horizontal clipping", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/contracts?client=${STALE_UUID}`);

    await expect(page.getByLabel("Client")).toHaveValue(STALE_UUID);
    await expect(page.getByLabel("Client").locator("option", { hasText: "Unavailable client" })).toHaveCount(1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });
});
