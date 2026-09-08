import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Leads / Sales Pipeline Phase 4 — real-browser coverage for the
 * Pipeline (Kanban) view: the List/Pipeline view switch, the 6 stage
 * columns, per-card stage movement/Mark Lost, the converted-lead locked
 * state, the mobile single-stage switcher, and accessibility. Every
 * backend edge case (org scoping, stage-grouping correctness, filter
 * safety, truncation) is already exhaustively covered in
 * test/integration/leads/pipeline-query.test.ts — this file deliberately
 * does not repeat them.
 */

async function setActiveOrg(context: BrowserContext, baseURL: string, organizationId: string): Promise<void> {
  await context.addCookies([
    {
      name: "active_organization_id",
      value: organizationId,
      domain: new URL(baseURL).hostname,
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

async function actAsMember(
  context: BrowserContext,
  baseURL: string,
  user: { id: string; email: string },
  organizationId: string,
): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, user, baseURL);
  await setActiveOrg(context, baseURL, organizationId);
}

const NAME_PREFIX = "E2E-Pipeline-Lead";

function uniqueName(): string {
  return `${NAME_PREFIX}-${randomUUID().slice(0, 8)}`;
}

/**
 * Scopes a locator to exactly one desktop board column — the board and
 * the mobile single-stage switcher are both always in the DOM (only
 * CSS-hidden via the `md:` breakpoint, matching this app's own Table/
 * RecordCardList precedent elsewhere), and the mobile view can render
 * the very same Lead if its own currently-selected stage matches. The
 * desktop column's own heading id (`pipeline-column-{STAGE}`, a real
 * aria-labelledby target, not a test-only hook) exists only on the
 * desktop board, so filtering by it never matches the mobile section.
 */
function desktopColumn(page: Page, stage: string) {
  return page.locator("section").filter({ has: page.locator(`#pipeline-column-${stage}`) });
}

let fixtures: TestFixtures;

test.beforeAll(async () => {
  fixtures = await seedE2EFixtures();
});

test.afterAll(async () => {
  await dbQuery("lead", "deleteMany", { where: { name: { startsWith: NAME_PREFIX } } });
  await cleanupTestData(fixtures);
});

test.describe("Leads Pipeline UI", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
  });

  test.describe("view switching", () => {
    // Runs first and deliberately creates no Lead of its own — proves
    // the whole-pipeline-empty CTA (Section P) before any other test in
    // this file has populated this fresh org's own Leads.
    test("the whole pipeline empty state shows the Add-first-lead CTA, not a bare empty board", async ({ page }) => {
      await page.goto("/leads?view=pipeline");
      await expect(page.getByText("No leads yet")).toBeVisible();
      await expect(page.getByRole("link", { name: "Add your first lead" })).toBeVisible();
      await expect(desktopColumn(page, "NEW")).toHaveCount(0);
    });

    test("default /leads is the List view", async ({ page }) => {
      await page.goto("/leads");
      await expect(page.getByRole("link", { name: "List", exact: true })).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("link", { name: "Pipeline", exact: true })).not.toHaveAttribute("aria-current", "page");
    });

    test("?view=pipeline renders the Pipeline board with all six canonical stage columns", async ({ page }) => {
      // At least one real Lead, otherwise the whole-pipeline-empty CTA
      // (Section P, and the previous test above) renders instead of the
      // board at all — this test is specifically about the populated
      // board's own column structure.
      await dbQuery("lead", "create", { data: { name: uniqueName(), organizationId: fixtures.orgA.id, stage: "NEW" } });
      await page.goto("/leads?view=pipeline");
      await expect(page.getByRole("link", { name: "Pipeline", exact: true })).toHaveAttribute("aria-current", "page");
      for (const stage of ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "WON", "LOST"]) {
        await expect(desktopColumn(page, stage)).toBeVisible();
      }
    });

    test("an invalid view param falls back safely to List", async ({ page }) => {
      await page.goto("/leads?view=bogus-not-a-real-view");
      await expect(page.getByRole("link", { name: "List", exact: true })).toHaveAttribute("aria-current", "page");
    });

    test("switching from a filtered List to Pipeline preserves the search term, and the matching lead is visible in its column", async ({ page }) => {
      const name = uniqueName();
      await dbQuery("lead", "create", { data: { name, organizationId: fixtures.orgA.id, stage: "NEW" } });
      await page.goto(`/leads?q=${name}`);
      await page.getByRole("link", { name: "Pipeline", exact: true }).click();
      await expect(page).toHaveURL(/view=pipeline/);
      await expect(page).toHaveURL(new RegExp(`q=${name}`));
      await expect(desktopColumn(page, "NEW").getByText(name)).toBeVisible();
    });
  });

  test.describe("stage movement", () => {
    test("move NEW to CONTACTED via the card's own Move-to select", async ({ page }) => {
      const name = uniqueName();
      await dbQuery("lead", "create", { data: { name, organizationId: fixtures.orgA.id, stage: "NEW" } });
      await page.goto("/leads?view=pipeline");
      await desktopColumn(page, "NEW").getByLabel(`Move ${name} to stage`).selectOption("CONTACTED");
      await expect(page.getByText("Stage updated")).toBeVisible();
      await expect(desktopColumn(page, "CONTACTED").getByText(name)).toBeVisible();
      await expect(desktopColumn(page, "NEW").getByText(name)).toHaveCount(0);
    });

    test("move QUALIFIED to PROPOSAL", async ({ page }) => {
      const name = uniqueName();
      await dbQuery("lead", "create", { data: { name, organizationId: fixtures.orgA.id, stage: "QUALIFIED" } });
      await page.goto("/leads?view=pipeline");
      await desktopColumn(page, "QUALIFIED").getByLabel(`Move ${name} to stage`).selectOption("PROPOSAL");
      await expect(page.getByText("Stage updated")).toBeVisible();
      await expect(desktopColumn(page, "PROPOSAL").getByText(name)).toBeVisible();
    });

    test("move a Lead to WON before conversion", async ({ page }) => {
      const name = uniqueName();
      await dbQuery("lead", "create", { data: { name, organizationId: fixtures.orgA.id, stage: "PROPOSAL" } });
      await page.goto("/leads?view=pipeline");
      await desktopColumn(page, "PROPOSAL").getByLabel(`Move ${name} to stage`).selectOption("WON");
      await expect(page.getByText("Stage updated")).toBeVisible();
      const wonCard = desktopColumn(page, "WON").locator("li", { hasText: name });
      await expect(wonCard).toBeVisible();
      // Not yet converted — no "Converted" indicator, still a normal
      // movable card (a Lead can sit in WON pre-conversion, per the
      // approved product model moveLeadStageAction's own doc comment
      // describes).
      await expect(wonCard.getByText("Converted")).toHaveCount(0);
      await expect(wonCard.getByLabel(`Move ${name} to stage`)).toBeVisible();
    });

    test("Mark Lost moves the card into the LOST column", async ({ page }) => {
      const name = uniqueName();
      await dbQuery("lead", "create", { data: { name, organizationId: fixtures.orgA.id, stage: "NEW" } });
      await page.goto("/leads?view=pipeline");
      const card = desktopColumn(page, "NEW").locator("li", { hasText: name });
      await card.getByRole("button", { name: "Mark lost" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Mark lost" }).click();
      await expect(page.getByText("Lead marked lost")).toBeVisible();
      await expect(desktopColumn(page, "LOST").getByText(name)).toBeVisible();
      await expect(desktopColumn(page, "NEW").getByText(name)).toHaveCount(0);
    });

    test("reactivating a LOST lead via Move-to clears lostReason and moves it out of LOST", async ({ page }) => {
      const name = uniqueName();
      const lead = await dbQuery<{ id: string }>("lead", "create", {
        data: { name, organizationId: fixtures.orgA.id, stage: "LOST", lostReason: "Budget cut" },
      });
      await page.goto("/leads?view=pipeline");
      await desktopColumn(page, "LOST").getByLabel(`Move ${name} to stage`).selectOption("CONTACTED");
      await expect(page.getByText("Stage updated")).toBeVisible();
      await expect(desktopColumn(page, "CONTACTED").getByText(name)).toBeVisible();
      const after = await dbQuery<{ stage: string; lostReason: string | null }>("lead", "findUniqueOrThrow", {
        where: { id: lead.id },
      });
      expect(after.stage).toBe("CONTACTED");
      expect(after.lostReason).toBeNull();
    });

    test("a converted Lead in WON shows the Converted indicator, has no Move-to/Mark-lost controls, and links to its Client", async ({ page }) => {
      const clientName = uniqueName();
      const client = await dbQuery<{ id: string }>("client", "create", {
        data: { name: clientName, organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
      });
      const name = uniqueName();
      await dbQuery("lead", "create", {
        data: {
          name,
          organizationId: fixtures.orgA.id,
          stage: "WON",
          convertedClientId: client.id,
          convertedAt: new Date().toISOString(),
        },
      });

      try {
        await page.goto("/leads?view=pipeline");
        const card = desktopColumn(page, "WON").locator("li", { hasText: name });
        // exact: true — "Converted to a client." (the caption below)
        // also contains "Converted" as a substring; this asserts the
        // badge specifically.
        await expect(card.getByText("Converted", { exact: true })).toBeVisible();
        await expect(card.getByLabel(`Move ${name} to stage`)).toHaveCount(0);
        await expect(card.getByRole("button", { name: "Mark lost" })).toHaveCount(0);
        await expect(card.getByRole("link", { name: "client" })).toHaveAttribute("href", `/clients/${client.id}/edit`);
      } finally {
        await dbQuery("client", "deleteMany", { where: { id: client.id } });
      }
    });
  });

  test.describe("mobile (390px)", () => {
    test("the stage switcher shows only the selected stage's cards, switching works, and there is no page-level horizontal overflow", async ({ page }) => {
      const nameNew = uniqueName();
      const nameContacted = uniqueName();
      await dbQuery("lead", "create", { data: { name: nameNew, organizationId: fixtures.orgA.id, stage: "NEW" } });
      await dbQuery("lead", "create", { data: { name: nameContacted, organizationId: fixtures.orgA.id, stage: "CONTACTED" } });

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/leads?view=pipeline");

      const newRegion = page.getByRole("region", { name: "New leads" });
      await expect(newRegion.getByText(nameNew)).toBeVisible();
      await expect(newRegion.getByText(nameContacted)).toHaveCount(0);

      await page.getByRole("link", { name: /^Contacted/ }).click();
      const contactedRegion = page.getByRole("region", { name: "Contacted leads" });
      await expect(contactedRegion.getByText(nameContacted)).toBeVisible();
      await expect(contactedRegion.getByText(nameNew)).toHaveCount(0);

      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    });
  });

  test.describe("accessibility", () => {
    test("stage movement is keyboard-reachable (a real native <select>, not a pointer-only control)", async ({ page }) => {
      const name = uniqueName();
      await dbQuery("lead", "create", { data: { name, organizationId: fixtures.orgA.id, stage: "NEW" } });
      await page.goto("/leads?view=pipeline");
      const select = desktopColumn(page, "NEW").getByLabel(`Move ${name} to stage`);
      await select.focus();
      await expect(select).toBeFocused();
      await select.selectOption("CONTACTED");
      await expect(page.getByText("Stage updated")).toBeVisible();
    });

    test("a card exposes an accessible edit link, a labeled Move-to select, and a labeled Mark lost button", async ({ page }) => {
      const name = uniqueName();
      await dbQuery("lead", "create", { data: { name, organizationId: fixtures.orgA.id, stage: "NEW" } });
      await page.goto("/leads?view=pipeline");
      const column = desktopColumn(page, "NEW");
      await expect(column.getByRole("link", { name })).toHaveAttribute("href", /\/edit$/);
      await expect(column.getByLabel(`Move ${name} to stage`)).toBeVisible();
      await expect(column.locator("li", { hasText: name }).getByRole("button", { name: "Mark lost" })).toBeVisible();
    });
  });
});
