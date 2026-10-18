import { test, expect, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Mobile Improvement Slice B2 — rollout of the proven B1
 * MobileFilterDisclosure pattern to Clients, Projects, Invoices,
 * Quotes, Tasks, Time, and Activity. Each surface's own activeCount
 * rule, Search-composition invariant, and desktop-visibility invariant
 * were already exhaustively proven once for Contracts
 * (contract-mobile-filter-disclosure.spec.ts); this file proves the
 * SAME mechanism works correctly when reused on each new surface's own
 * real fields/params, not a re-derivation of the mechanism itself.
 * Deliberately lean per surface — deeper domain semantics (Saved Views
 * round-trips, stale-filter sentinels, bulk toolbars, List/Board
 * routing) are already exhaustively covered by each surface's own
 * existing exact-SHA suite and are not re-derived here.
 */

let fixtures: TestFixtures;

function uniqueMarker(prefix: string): string {
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

// Reused verbatim from contract-mobile-filter-disclosure.spec.ts — see
// that file's own header comment for why a plain CSS locator (not a
// role query) is the correct, unambiguous way to reach the native
// <summary> toggle.
function filterToggle(page: Page) {
  return page.locator("details.mobile-filter-disclosure > summary");
}

function disclosure(page: Page) {
  return page.locator("details.mobile-filter-disclosure");
}

test.beforeAll(async () => {
  fixtures = await seedE2EFixtures();
});

test.afterAll(async () => {
  await cleanupTestData(fixtures);
});

test.describe("Clients mobile filter disclosure", () => {
  let seededClientIds: string[] = [];

  async function seedClient(overrides: Record<string, unknown> = {}) {
    const name = (overrides.name as string) ?? uniqueMarker("E2E-MFD-Client");
    const created = await dbQuery<{ id: string; name: string }>("client", "create", {
      data: { organizationId: fixtures.orgA.id, userId: fixtures.owner.id, ...overrides, name },
    });
    seededClientIds.push(created.id);
    return created;
  }

  test.beforeEach(async ({ page, baseURL }) => {
    await actAsOwner(page, baseURL!);
  });

  test.afterEach(async () => {
    if (seededClientIds.length > 0) {
      await dbQuery("client", "deleteMany", { where: { id: { in: seededClientIds } } });
      seededClientIds = [];
    }
  });

  test("390px: collapsed by default, Search/Saved Views visible, Status/Tag/Sort hidden until expand", async ({ page }) => {
    const client = await seedClient();
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/clients");

    await expect(filterToggle(page)).toHaveText("Filter");
    await expect(disclosure(page)).not.toHaveAttribute("open", "");
    await expect(page.locator("form").getByLabel("Search")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save current view" })).toBeVisible();
    await expect(page.getByLabel("Status").first()).toBeHidden();
    await expect(page.getByLabel("Tag")).toBeHidden();
    await expect(page.getByLabel("Sort by")).toBeHidden();
    await expect(page.locator("li", { hasText: client.name })).toBeVisible();
  });

  test("390px: expand reveals Status/Tag/Sort; a status filter opens the disclosure with Filter (1); sort alone does not", async ({ page }) => {
    await seedClient();
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/clients");

    await filterToggle(page).click();
    await expect(page.getByLabel("Status").first()).toBeVisible();
    await expect(page.getByLabel("Tag")).toBeVisible();
    await expect(page.getByLabel("Sort by")).toBeVisible();

    await page.goto("/clients?status=active");
    await expect(filterToggle(page)).toHaveText("Filter (1)");
    await expect(disclosure(page)).toHaveAttribute("open", "");

    await page.goto("/clients?sort=name:asc");
    await expect(filterToggle(page)).toHaveText("Filter");
    await expect(disclosure(page)).not.toHaveAttribute("open", "");
  });

  test("390px: Clear returns to Filter/closed and the RecordCard list is unaffected", async ({ page }) => {
    const client = await seedClient();
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/clients?status=active");

    await page.locator("form").getByRole("link", { name: "Clear", exact: true }).click();
    await expect(page).not.toHaveURL(/status=/);
    await expect(filterToggle(page)).toHaveText("Filter");
    await expect(disclosure(page)).not.toHaveAttribute("open", "");
    await expect(page.locator("li", { hasText: client.name })).toBeVisible();
  });

  test("desktop (1280px): every filter visible without expanding, no Filter summary", async ({ page }) => {
    await seedClient();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/clients");

    await expect(filterToggle(page)).toBeHidden();
    await expect(page.getByLabel("Status").first()).toBeVisible();
    await expect(page.getByLabel("Tag")).toBeVisible();
    await expect(page.getByLabel("Sort by")).toBeVisible();
  });
});

test.describe("Projects mobile filter disclosure", () => {
  let seededProjectIds: string[] = [];

  async function seedProject(overrides: Record<string, unknown> = {}) {
    const name = (overrides.name as string) ?? uniqueMarker("E2E-MFD-Project");
    const created = await dbQuery<{ id: string; name: string }>("project", "create", {
      data: { organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, ownerId: fixtures.owner.id, ...overrides, name },
    });
    seededProjectIds.push(created.id);
    return created;
  }

  test.beforeEach(async ({ page, baseURL }) => {
    await actAsOwner(page, baseURL!);
  });

  test.afterEach(async () => {
    if (seededProjectIds.length > 0) {
      await dbQuery("project", "deleteMany", { where: { id: { in: seededProjectIds } } });
      seededProjectIds = [];
    }
  });

  test("390px: collapsed by default, Search/Saved Views visible, Status/Sort hidden until expand", async ({ page }) => {
    const project = await seedProject();
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/projects");

    await expect(filterToggle(page)).toHaveText("Filter");
    await expect(page.locator("form").getByLabel("Search")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save current view" })).toBeVisible();
    await expect(page.getByLabel("Status").first()).toBeHidden();
    await expect(page.getByLabel("Sort by")).toBeHidden();
    await expect(page.locator("li", { hasText: project.name })).toBeVisible();
  });

  test("390px: status filter -> Filter (1), open; sort alone excluded; Clear resets", async ({ page }) => {
    await seedProject();
    await page.setViewportSize({ width: 390, height: 900 });

    await page.goto("/projects?status=in_progress");
    await expect(filterToggle(page)).toHaveText("Filter (1)");
    await expect(disclosure(page)).toHaveAttribute("open", "");
    await expect(page.getByLabel("Status").first()).toHaveValue("in_progress");

    await page.goto("/projects?sort=name:asc");
    await expect(filterToggle(page)).toHaveText("Filter");

    await page.goto("/projects?status=in_progress");
    await page.locator("form").getByRole("link", { name: "Clear", exact: true }).click();
    await expect(page).not.toHaveURL(/status=/);
    await expect(filterToggle(page)).toHaveText("Filter");
  });

  test("desktop (1280px): every filter visible without expanding", async ({ page }) => {
    await seedProject();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/projects");

    await expect(filterToggle(page)).toBeHidden();
    await expect(page.getByLabel("Status").first()).toBeVisible();
    await expect(page.getByLabel("Sort by")).toBeVisible();
  });
});

test.describe("Invoices mobile filter disclosure", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await actAsOwner(page, baseURL!);
  });

  test("390px: collapsed by default, quick chips/Saved Views external, Status/Sort inside", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/invoices");

    await expect(filterToggle(page)).toHaveText("Filter");
    await expect(page.locator("form").getByLabel("Search")).toBeVisible();
    await expect(page.getByRole("link", { name: "Draft" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save current view" })).toBeVisible();
    await expect(page.getByLabel("Status").first()).toBeHidden();
    await expect(page.getByLabel("Sort by")).toBeHidden();
  });

  test("390px: the Draft quick chip sets the shared status param once, opens the disclosure, dropdown stays truthful; sort alone is excluded", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/invoices");

    await page.getByRole("link", { name: "Draft" }).click();
    await expect(page).toHaveURL(/status=DRAFT/);
    await expect(filterToggle(page)).toHaveText("Filter (1)");
    await expect(disclosure(page)).toHaveAttribute("open", "");
    await expect(page.getByLabel("Status").first()).toHaveValue("DRAFT");

    await page.goto("/invoices?sort=createdAt:asc");
    await expect(filterToggle(page)).toHaveText("Filter");
  });

  test("390px: Clear restores defaults", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/invoices?status=SENT");
    await expect(filterToggle(page)).toHaveText("Filter (1)");

    await page.locator("form").getByRole("link", { name: "Clear", exact: true }).click();
    await expect(page).not.toHaveURL(/status=/);
    await expect(filterToggle(page)).toHaveText("Filter");
  });

  test("desktop (1280px): every filter visible without expanding", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/invoices");

    await expect(filterToggle(page)).toBeHidden();
    await expect(page.getByLabel("Status").first()).toBeVisible();
    await expect(page.getByLabel("Sort by")).toBeVisible();
  });
});

test.describe("Quotes mobile filter disclosure", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await actAsOwner(page, baseURL!);
  });

  test("390px: collapsed by default, Saved Views external, Status/Target/Archived/Sort inside", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/quotes");

    await expect(filterToggle(page)).toHaveText("Filter");
    await expect(page.locator("form").getByLabel("Search")).toBeVisible();
    await expect(page.getByLabel("Status").first()).toBeHidden();
    await expect(page.getByLabel("Target")).toBeHidden();
    await expect(page.getByLabel("Archive status")).toBeHidden();
    await expect(page.getByLabel("Sort by")).toBeHidden();
  });

  test("390px: status/target/archived each contribute 1 truthfully, including a derived EXPIRED status value; sort excluded", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });

    await page.goto("/quotes?status=EXPIRED");
    await expect(filterToggle(page)).toHaveText("Filter (1)");
    await expect(disclosure(page)).toHaveAttribute("open", "");
    await expect(page.getByLabel("Status").first()).toHaveValue("EXPIRED");

    await page.goto("/quotes?status=DRAFT&targetType=LEAD&archived=1");
    await expect(filterToggle(page)).toHaveText("Filter (3)");

    await page.goto("/quotes?sort=createdAt:asc");
    await expect(filterToggle(page)).toHaveText("Filter");
  });

  test("390px: archived-only empty state and its own Clear link are preserved", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/quotes?archived=1");

    await expect(filterToggle(page)).toHaveText("Filter (1)");
    // Zero archived quotes is the expected fixture state -- this proves
    // the existing archived-only empty-state branch still renders,
    // completely independent of the new disclosure.
    const emptyState = page.getByText(/No archived quotes|No matching quotes/);
    await expect(emptyState).toBeVisible();
  });

  test("desktop (1280px): every filter visible without expanding", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/quotes");

    await expect(filterToggle(page)).toBeHidden();
    await expect(page.getByLabel("Status").first()).toBeVisible();
    await expect(page.getByLabel("Target")).toBeVisible();
    await expect(page.getByLabel("Archive status")).toBeVisible();
    await expect(page.getByLabel("Sort by")).toBeVisible();
  });
});

test.describe("Tasks mobile filter disclosure", () => {
  let seededTaskIds: string[] = [];

  async function seedTask(overrides: Record<string, unknown> = {}) {
    const title = (overrides.title as string) ?? uniqueMarker("E2E-MFD-Task");
    const created = await dbQuery<{ id: string; title: string }>("task", "create", {
      data: {
        organizationId: fixtures.orgA.id,
        projectId: fixtures.project.id,
        status: "TODO",
        priority: "MEDIUM",
        ...overrides,
        title,
      },
    });
    seededTaskIds.push(created.id);
    return created;
  }

  test.beforeEach(async ({ page, baseURL }) => {
    await actAsOwner(page, baseURL!);
  });

  test.afterEach(async () => {
    if (seededTaskIds.length > 0) {
      await dbQuery("task", "deleteMany", { where: { id: { in: seededTaskIds } } });
      seededTaskIds = [];
    }
  });

  test("390px: collapsed by default, quick chips and List/Board toggle external, Status/Priority inside", async ({ page }) => {
    const task = await seedTask();
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/tasks");

    await expect(filterToggle(page)).toHaveText("Filter");
    await expect(page.locator("form").getByLabel("Search")).toBeVisible();
    await expect(page.getByRole("link", { name: "My tasks" })).toBeVisible();
    await expect(page.getByRole("link", { name: "List" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Board" })).toBeVisible();
    await expect(page.getByLabel("Status").first()).toBeHidden();
    await expect(page.getByLabel("Priority")).toBeHidden();
    await expect(page.locator("li", { hasText: task.title })).toBeVisible();
  });

  test("390px: status/priority each contribute 1 (the High priority chip shares the priority param); sort and view mode excluded; chip-only booleans (overdue) never open the disclosure", async ({ page }) => {
    await seedTask();
    await page.setViewportSize({ width: 390, height: 900 });

    await page.goto("/tasks?priority=HIGH");
    await expect(filterToggle(page)).toHaveText("Filter (1)");
    await expect(disclosure(page)).toHaveAttribute("open", "");
    await expect(page.getByRole("link", { name: "High priority" })).toHaveAttribute("aria-current", "true");

    await page.goto("/tasks?status=TODO&priority=HIGH");
    await expect(filterToggle(page)).toHaveText("Filter (2)");

    await page.goto("/tasks?sort=dueDate:asc");
    await expect(filterToggle(page)).toHaveText("Filter");

    await page.goto("/tasks?overdue=true");
    await expect(filterToggle(page)).toHaveText("Filter");
    await expect(disclosure(page)).not.toHaveAttribute("open", "");
  });

  test("390px: Sort by is present in List view and absent in Board view, exactly as before this slice", async ({ page }) => {
    await seedTask();
    await page.setViewportSize({ width: 390, height: 900 });

    await page.goto("/tasks?view=list");
    await filterToggle(page).click();
    await expect(page.getByLabel("Sort by")).toBeVisible();

    await page.goto("/tasks?view=board");
    await filterToggle(page).click();
    await expect(page.getByLabel("Sort by")).toHaveCount(0);
  });

  test("desktop (1280px): every filter visible without expanding", async ({ page }) => {
    await seedTask();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/tasks");

    await expect(filterToggle(page)).toBeHidden();
    await expect(page.getByLabel("Status").first()).toBeVisible();
    await expect(page.getByLabel("Priority")).toBeVisible();
  });
});

test.describe("Time mobile filter disclosure", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await actAsOwner(page, baseURL!);
  });

  test("390px: no Search field; compact Filter summary replaces the dense 5-control block; Filter/Clear stay outside, fields collapse", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/time");

    await expect(page.locator("form").getByLabel("Search")).toHaveCount(0);
    await expect(filterToggle(page)).toHaveText("Filter");
    await expect(page.getByRole("button", { name: "Filter", exact: true })).toBeVisible();
    await expect(page.getByLabel("From")).toBeHidden();
    await expect(page.getByLabel("To")).toBeHidden();
    await expect(page.getByLabel("Project")).toBeHidden();
    await expect(page.getByLabel("Member")).toBeHidden();
    await expect(page.getByLabel("Billable")).toBeHidden();
  });

  test("390px: expand reveals all five native controls; progressive filters increment the count; Clear restores defaults", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/time");

    await filterToggle(page).click();
    await expect(page.getByLabel("From")).toBeVisible();
    await expect(page.getByLabel("To")).toBeVisible();
    await expect(page.getByLabel("Project")).toBeVisible();
    await expect(page.getByLabel("Member")).toBeVisible();
    await expect(page.getByLabel("Billable")).toBeVisible();

    // B1 Search-composition regression class, applied to Time's own
    // different composition path (a custom filter bar, not
    // SearchFilterBar): the Filter submit button must stay at/above the
    // disclosure's own row even once expanded, never pushed below the
    // five now-visible fields.
    const filterButtonBox = (await page.getByRole("button", { name: "Filter", exact: true }).boundingBox())!;
    const summaryBox = (await filterToggle(page).boundingBox())!;
    expect(filterButtonBox.y).toBeLessThanOrEqual(summaryBox.y + 2);

    await page.goto("/time?from=2026-01-01");
    await expect(filterToggle(page)).toHaveText("Filter (1)");
    await expect(disclosure(page)).toHaveAttribute("open", "");

    await page.goto("/time?from=2026-01-01&billable=true");
    await expect(filterToggle(page)).toHaveText("Filter (2)");

    await page.locator("form").getByRole("link", { name: "Clear filters" }).click();
    await expect(page).not.toHaveURL(/from=|billable=/);
    await expect(filterToggle(page)).toHaveText("Filter");
    await expect(disclosure(page)).not.toHaveAttribute("open", "");
  });

  test("desktop (1280px): every field visible without expanding", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/time");

    await expect(filterToggle(page)).toBeHidden();
    await expect(page.getByLabel("From")).toBeVisible();
    await expect(page.getByLabel("To")).toBeVisible();
    await expect(page.getByLabel("Project")).toBeVisible();
    await expect(page.getByLabel("Member")).toBeVisible();
    await expect(page.getByLabel("Billable")).toBeVisible();
  });
});

test.describe("Activity mobile filter disclosure", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await actAsOwner(page, baseURL!);
  });

  test("390px: no Search field; collapsed by default; Filter/Clear stay outside, fields collapse", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/activity");

    await expect(page.locator("form").getByLabel("Search")).toHaveCount(0);
    await expect(filterToggle(page)).toHaveText("Filter");
    await expect(page.getByRole("button", { name: "Filter", exact: true })).toBeVisible();
    await expect(page.getByLabel("Entity")).toBeHidden();
    await expect(page.getByLabel("Category")).toBeHidden();
    await expect(page.getByLabel("Member")).toBeHidden();
  });

  test("390px: expand reveals all five controls; one filter -> Filter (1); Clear works; the existing disclaimer copy is unaffected", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/activity");

    await filterToggle(page).click();
    await expect(page.getByLabel("Entity")).toBeVisible();
    await expect(page.getByLabel("Category")).toBeVisible();
    await expect(page.getByLabel("Member")).toBeVisible();
    await expect(page.getByLabel("From")).toBeVisible();
    await expect(page.getByLabel("To")).toBeVisible();
    await expect(
      page.getByText("Activity is recorded from the moment this feature was enabled. Earlier changes are not available."),
    ).toBeVisible();

    // B1 Search-composition regression class, applied to Activity's own
    // different composition path -- see Time's own identical comment.
    const filterButtonBox = (await page.getByRole("button", { name: "Filter", exact: true }).boundingBox())!;
    const summaryBox = (await filterToggle(page).boundingBox())!;
    expect(filterButtonBox.y).toBeLessThanOrEqual(summaryBox.y + 2);

    await page.goto("/activity?entityType=CLIENT");
    await expect(filterToggle(page)).toHaveText("Filter (1)");
    await expect(disclosure(page)).toHaveAttribute("open", "");

    await page.locator("form").getByRole("link", { name: "Clear", exact: true }).click();
    await expect(page).not.toHaveURL(/entityType=/);
    await expect(filterToggle(page)).toHaveText("Filter");
  });

  test("desktop (1280px): every field visible without expanding", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/activity");

    await expect(filterToggle(page)).toBeHidden();
    await expect(page.getByLabel("Entity")).toBeVisible();
    await expect(page.getByLabel("Category")).toBeVisible();
    await expect(page.getByLabel("Member")).toBeVisible();
  });
});
