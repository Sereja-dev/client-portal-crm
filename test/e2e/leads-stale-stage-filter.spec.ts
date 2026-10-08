import { test, expect, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Stale custom-status filter hardening — real browser coverage for the
 * Leads List surface, mirroring clients-stale-status-filter.spec.ts's
 * own identical shape (buildLeadWhere's stage-resolution branch shares
 * the identical fix as buildClientWhere/buildProjectWhere). See that
 * file's own header comment for the full "why". Domain-layer
 * correctness is already exhaustively covered in
 * test/integration/leads/list-query.test.ts.
 *
 * Also proves the one required negative: Pipeline mode is completely
 * unaffected by this fix — `stage` is discarded before
 * fetchLeadPipelineColumns ever runs (pipeline-query.ts's own
 * `{ ...listParams, stage: undefined }`), and Pipeline never renders a
 * Stage filter control at all, so there is no sentinel/fail-closed
 * behavior to add there (locked spec — do not touch Pipeline).
 */

let fixtures: TestFixtures;
let seededLeadIds: string[] = [];
let seededDefinitionIds: string[] = [];
const STALE_KEY = "totally-made-up-stage-key-xyz";

function uniqueName(prefix: string): string {
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

async function seedLead(overrides: Record<string, unknown> = {}): Promise<{ id: string; name: string }> {
  const name = (overrides.name as string) ?? uniqueName("E2E-StaleStage-Lead");
  const created = await dbQuery<{ id: string; name: string }>("lead", "create", {
    data: {
      organizationId: fixtures.orgA.id,
      ...overrides,
      name,
    },
  });
  seededLeadIds.push(created.id);
  return created;
}

async function seedCustomStatusDefinition(overrides: Record<string, unknown>): Promise<{ id: string; key: string; label: string }> {
  const created = await dbQuery<{ id: string; key: string; label: string }>("customStatusDefinition", "create", {
    data: {
      organizationId: fixtures.orgA.id,
      entityType: "LEAD",
      position: 500,
      ...overrides,
    },
  });
  seededDefinitionIds.push(created.id);
  return created;
}

async function cleanupSeeded(): Promise<void> {
  if (seededLeadIds.length > 0) {
    await dbQuery("lead", "deleteMany", { where: { id: { in: seededLeadIds } } });
    seededLeadIds = [];
  }
  if (seededDefinitionIds.length > 0) {
    await dbQuery("customStatusDefinition", "deleteMany", { where: { id: { in: seededDefinitionIds } } });
    seededDefinitionIds = [];
  }
}

test.describe("Leads List stale custom-status (stage) filter hardening", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.beforeEach(async ({ page, baseURL }) => {
    await actAsOwner(page, baseURL!);
  });

  test.afterEach(async () => {
    await cleanupSeeded();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test("stale (never-existed) stage key: URL preserved, sentinel shown, zero truthful results, no raw key visible", async ({ page }) => {
    const ordinary = await seedLead({ stage: "NEW" });

    await page.goto(`/leads?view=list&stage=${STALE_KEY}`);

    await expect(page).toHaveURL(new RegExp(`stage=${STALE_KEY}`));
    const stageSelect = page.getByLabel("Stage");
    await expect(stageSelect).toHaveValue(STALE_KEY);
    await expect(stageSelect.locator("option", { hasText: "Unavailable stage" })).toHaveCount(1);
    await expect(page.getByText("No leads match your filters")).toBeVisible();
    await expect(page.getByRole("link", { name: "Clear filters" })).toBeVisible();
    await expect(page.getByText(ordinary.name)).toHaveCount(0);

    const optionTexts = await stageSelect.locator("option").allTextContents();
    for (const text of optionTexts) {
      expect(text).not.toContain(STALE_KEY);
    }
  });

  test("Search submit preserves the stale stage; explicitly choosing All stages clears it", async ({ page }) => {
    const ordinary = await seedLead({ stage: "NEW" });

    await page.goto(`/leads?view=list&stage=${STALE_KEY}`);
    await page.locator("form").getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(new RegExp(`stage=${STALE_KEY}`));
    await expect(page.getByLabel("Stage")).toHaveValue(STALE_KEY);
    await expect(page.getByText("No leads match your filters")).toBeVisible();

    await page.getByLabel("Stage").selectOption("");
    await page.locator("form").getByRole("button", { name: "Search" }).click();
    await expect(page.getByLabel("Stage")).toHaveValue("");
    await expect(page.getByText(ordinary.name).first()).toBeVisible();
  });

  test("Sort change preserves the stale stage filter rather than dropping it", async ({ page }) => {
    await page.goto(`/leads?view=list&stage=${STALE_KEY}`);

    await page.getByLabel("Sort by").selectOption("name:asc");
    await expect(page).toHaveURL(new RegExp(`stage=${STALE_KEY}`));
    await expect(page).toHaveURL(/sort=name/);
    await expect(page.getByLabel("Stage")).toHaveValue(STALE_KEY);
    await expect(page.getByLabel("Stage").locator("option", { hasText: "Unavailable stage" })).toHaveCount(1);
  });

  test("Clear removes the stale stage filter entirely and normal results return", async ({ page }) => {
    const ordinary = await seedLead({ stage: "NEW" });

    await page.goto(`/leads?view=list&stage=${STALE_KEY}`);
    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(page).not.toHaveURL(/stage=/);
    await expect(page.getByLabel("Stage")).toHaveValue("");
    await expect(page.getByLabel("Stage").locator("option", { hasText: "Unavailable stage" })).toHaveCount(0);
    await expect(page.getByText(ordinary.name).first()).toBeVisible();
  });

  test("a valid stage filter still works normally — no sentinel, real narrowing", async ({ page }) => {
    const definition = await seedCustomStatusDefinition({ key: "qualified", label: "Qualified", isSystem: true });
    const qualifiedLead = await seedLead({ statusDefinitionId: definition.id });

    await page.goto(`/leads?view=list&stage=qualified`);
    const stageSelect = page.getByLabel("Stage");
    await expect(stageSelect).toHaveValue("qualified");
    await expect(stageSelect.locator("option", { hasText: "Unavailable stage" })).toHaveCount(0);
    await expect(page.getByText(qualifiedLead.name).first()).toBeVisible();
  });

  test("a real but ARCHIVED custom stage definition remains valid — real label shown, no sentinel, correct narrowing", async ({ page }) => {
    const definition = await seedCustomStatusDefinition({
      key: `archived-e2e-${Date.now()}`,
      label: "Archived E2E Stage",
      archivedAt: new Date().toISOString(),
    });
    const taggedLead = await seedLead({ statusDefinitionId: definition.id });

    await page.goto(`/leads?view=list&stage=${definition.key}`);
    const stageSelect = page.getByLabel("Stage");
    await expect(stageSelect).toHaveValue(definition.key);
    await expect(stageSelect.locator("option", { hasText: "Unavailable stage" })).toHaveCount(0);
    await expect(stageSelect.locator("option", { hasText: "Archived E2E Stage (archived)" })).toHaveCount(1);
    await expect(page.getByText(taggedLead.name).first()).toBeVisible();
  });

  test("390px: the Unavailable stage sentinel renders readably with no destructive horizontal clipping", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/leads?view=list&stage=${STALE_KEY}`);

    await expect(page.getByLabel("Stage")).toHaveValue(STALE_KEY);
    await expect(page.getByLabel("Stage").locator("option", { hasText: "Unavailable stage" })).toHaveCount(1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });

  test("Pipeline regression: a stale stage key has zero effect on Pipeline mode — loads normally, no Stage control, no error", async ({ page }) => {
    // Pipeline's own board renders one column per live CustomStatusDefinition
    // (fetchLeadPipelineColumns) -- seedE2EFixtures() doesn't bootstrap any
    // for its fixture org (same reasoning as every other test above), so a
    // real "new" definition must exist here for the board to render ANY
    // column/card at all, independent of this test's own stale-stage
    // assertion.
    const newDefinition = await seedCustomStatusDefinition({ key: "new", label: "New", isSystem: true, position: 0 });
    const pipelineLead = await seedLead({ statusDefinitionId: newDefinition.id });

    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await page.goto(`/leads?view=pipeline&stage=${STALE_KEY}`);

    // Pipeline mode never renders a Stage FILTER control at all (its own
    // SearchFilterBar passes only [assigneeFilter, archivedFilter] — see
    // leads/page.tsx's own "No stage filter here" comment). Per-card
    // status-change selects (a different, pre-existing, unrelated
    // control) do exist and are unaffected by this assertion.
    await expect(page.getByRole("combobox", { name: "Stage", exact: true })).toHaveCount(0);
    // No sentinel behavior leaks into Pipeline — there is nothing here
    // for it to attach to.
    await expect(page.getByText("Unavailable stage")).toHaveCount(0);
    // The stale key has no bearing on which column the lead appears in --
    // it's simply never read by Pipeline's own query path at all.
    await expect(page.getByText(pipelineLead.name).first()).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });
});
