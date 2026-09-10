import { test, expect, type BrowserContext, type Page, type Locator } from "@playwright/test";
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
 *
 * Custom Statuses Phase 2B — Completion Pass (Section G/H): this whole
 * file was silently broken at origin/main (8c2994b, Custom Statuses
 * Phase 2A) — that commit changed each desktop column's own heading id
 * from `pipeline-column-{STAGE}` to `pipeline-column-{definitionId}`
 * (a real UUID, unpredictable from a test) without updating this file's
 * own `desktopColumn()` helper, which still built the old, now-wrong id.
 * Reproduced directly against origin/main before this fix (git worktree
 * + real build). Fixed here by locating a column via its own heading
 * TEXT (an accessible `region`, from `aria-labelledby`) instead of a
 * synthesized id — which also, incidentally, is the only way a genuinely
 * custom column (no stable enum value to build an id from at all) could
 * ever be targeted by a test in the first place. Every Move-to select's
 * own aria-label and option values also changed in this phase (Section
 * M: `Change {name}'s status`, options keyed by definitionId, not the
 * raw LeadStage string) — updated throughout.
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
 * the very same Lead if its own currently-selected stage matches. Each
 * desktop column is a real accessible `region` (a `<section>` with
 * `aria-labelledby` pointing at its own `<h2>`) — but that `<h2>`'s own
 * accessible name is `{label}{total}` (the column's live card count sits
 * in a second, trailing <span> inside the SAME heading — e.g. "New1" /
 * "New 2"), so matching the region by its full accessible name can never
 * be an exact `label`-only match. Located instead by the `<h2>` whose
 * own text STARTS WITH `label` (only the desktop board renders any
 * `<h2>` at all — the mobile switcher's own per-stage `<section>` uses a
 * plain `aria-label`, no heading — so this can never ambiguously match
 * the mobile switcher's own differently-worded "New leads" region, both
 * of which are simultaneously in the DOM), then that heading's own
 * `<section>` ancestor.
 */
function desktopColumn(page: Page, label: string) {
  return page.locator("section").filter({ has: page.locator("h2", { hasText: new RegExp(`^${label}`) }) });
}

function moveToSelect(column: Locator, name: string) {
  return column.getByLabel(`Change ${name}'s status`);
}

// Custom Statuses Phase 2B — Completion Pass (Section G): every card's
// own generic status <select> (and the desktop board's own columns)
// source from this org's real CustomStatusDefinition rows — with none
// bootstrapped (seedE2EFixtures()'s own org fixture is never
// auto-bootstrapped, see bootstrap.ts's own doc comment), the board
// would have no columns and every card's select would have zero
// options. Byte-for-byte copy of bootstrap.ts's own LEAD seed values.
async function bootstrapLeadStatuses(organizationId: string): Promise<void> {
  await dbQuery("customStatusDefinition", "createMany", {
    data: [
      { organizationId, entityType: "LEAD", key: "new", label: "New", color: "NEUTRAL", position: 0, isDefault: true, isSystem: true },
      { organizationId, entityType: "LEAD", key: "contacted", label: "Contacted", color: "INFO", position: 1, isDefault: false, isSystem: true },
      { organizationId, entityType: "LEAD", key: "qualified", label: "Qualified", color: "INFO", position: 2, isDefault: false, isSystem: true },
      { organizationId, entityType: "LEAD", key: "proposal", label: "Proposal", color: "INFO", position: 3, isDefault: false, isSystem: true },
      { organizationId, entityType: "LEAD", key: "won", label: "Won", color: "SUCCESS", position: 4, isDefault: false, isSystem: true },
      { organizationId, entityType: "LEAD", key: "lost", label: "Lost", color: "DANGER", position: 5, isDefault: false, isSystem: true },
    ],
  });
}

let fixtures: TestFixtures;

test.beforeAll(async () => {
  fixtures = await seedE2EFixtures();
  await bootstrapLeadStatuses(fixtures.orgA.id);
});

test.afterAll(async () => {
  await dbQuery("lead", "deleteMany", { where: { name: { startsWith: NAME_PREFIX } } });
  await dbQuery("customStatusDefinition", "deleteMany", { where: { organizationId: fixtures.orgA.id, isSystem: false } });
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
      await expect(desktopColumn(page, "New")).toHaveCount(0);
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
      for (const label of ["New", "Contacted", "Qualified", "Proposal", "Won", "Lost"]) {
        await expect(desktopColumn(page, label)).toBeVisible();
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
      await expect(desktopColumn(page, "New").getByText(name)).toBeVisible();
    });
  });

  test.describe("stage movement", () => {
    test("move NEW to CONTACTED via the card's own status select", async ({ page }) => {
      const name = uniqueName();
      await dbQuery("lead", "create", { data: { name, organizationId: fixtures.orgA.id, stage: "NEW" } });
      await page.goto("/leads?view=pipeline");
      await moveToSelect(desktopColumn(page, "New"), name).selectOption({ label: "Contacted" });
      await expect(page.getByText("Status updated")).toBeVisible();
      await expect(desktopColumn(page, "Contacted").getByText(name)).toBeVisible();
      await expect(desktopColumn(page, "New").getByText(name)).toHaveCount(0);
    });

    test("move QUALIFIED to PROPOSAL", async ({ page }) => {
      const name = uniqueName();
      await dbQuery("lead", "create", { data: { name, organizationId: fixtures.orgA.id, stage: "QUALIFIED" } });
      await page.goto("/leads?view=pipeline");
      await moveToSelect(desktopColumn(page, "Qualified"), name).selectOption({ label: "Proposal" });
      await expect(page.getByText("Status updated")).toBeVisible();
      await expect(desktopColumn(page, "Proposal").getByText(name)).toBeVisible();
    });

    test("move a Lead to WON before conversion", async ({ page }) => {
      const name = uniqueName();
      await dbQuery("lead", "create", { data: { name, organizationId: fixtures.orgA.id, stage: "PROPOSAL" } });
      await page.goto("/leads?view=pipeline");
      await moveToSelect(desktopColumn(page, "Proposal"), name).selectOption({ label: "Won" });
      await expect(page.getByText("Status updated")).toBeVisible();
      const wonCard = desktopColumn(page, "Won").locator("li", { hasText: name });
      await expect(wonCard).toBeVisible();
      // Not yet converted — no "Converted" indicator, still a normal
      // movable card (a Lead can sit in WON pre-conversion, per the
      // approved product model moveLeadStageAction's own doc comment
      // describes).
      await expect(wonCard.getByText("Converted", { exact: true })).toHaveCount(0);
      await expect(moveToSelect(wonCard, name)).toBeVisible();
    });

    test("Mark Lost moves the card into the LOST column", async ({ page }) => {
      const name = uniqueName();
      await dbQuery("lead", "create", { data: { name, organizationId: fixtures.orgA.id, stage: "NEW" } });
      await page.goto("/leads?view=pipeline");
      const card = desktopColumn(page, "New").locator("li", { hasText: name });
      await card.getByRole("button", { name: "Mark lost" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Mark lost" }).click();
      await expect(page.getByText("Lead marked lost")).toBeVisible();
      await expect(desktopColumn(page, "Lost").getByText(name)).toBeVisible();
      await expect(desktopColumn(page, "New").getByText(name)).toHaveCount(0);
    });

    test("reactivating a LOST lead via the status select clears lostReason and moves it out of LOST — LOST itself is never re-offered as a new target (Section M/F)", async ({ page }) => {
      const name = uniqueName();
      const lead = await dbQuery<{ id: string }>("lead", "create", {
        data: { name, organizationId: fixtures.orgA.id, stage: "LOST", lostReason: "Budget cut" },
      });
      await page.goto("/leads?view=pipeline");
      const select = moveToSelect(desktopColumn(page, "Lost"), name);
      // The Lead's own current LOST status is shown (Section M: kept
      // visible only because it's already current), but is never a
      // selectable target once moved away from — proven implicitly by
      // reactivating below and confirming it's excluded from the option
      // list at that point (Section F reverify).
      await select.selectOption({ label: "Contacted" });
      await expect(page.getByText("Status updated")).toBeVisible();
      await expect(desktopColumn(page, "Contacted").getByText(name)).toBeVisible();
      const after = await dbQuery<{ stage: string; lostReason: string | null }>("lead", "findUniqueOrThrow", {
        where: { id: lead.id },
      });
      expect(after.stage).toBe("CONTACTED");
      expect(after.lostReason).toBeNull();

      // Section F (CRITICAL, reverified): once no longer the Lead's own
      // current status, "Lost" is never offered as a selectable option.
      const reactivatedSelect = moveToSelect(desktopColumn(page, "Contacted"), name);
      const optionLabels = await reactivatedSelect.locator("option").allTextContents();
      expect(optionLabels).not.toContain("Lost");
    });

    test("a converted Lead in WON shows the Converted indicator, has no status select/Mark-lost controls, and links to its Client", async ({ page }) => {
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
        const card = desktopColumn(page, "Won").locator("li", { hasText: name });
        // exact: true — "Converted to a client." (the caption below)
        // also contains "Converted" as a substring; this asserts the
        // badge specifically.
        await expect(card.getByText("Converted", { exact: true })).toBeVisible();
        await expect(card.getByLabel(`Change ${name}'s status`)).toHaveCount(0);
        await expect(card.getByRole("button", { name: "Mark lost" })).toHaveCount(0);
        await expect(card.getByRole("link", { name: "client" })).toHaveAttribute("href", `/clients/${client.id}/edit`);
      } finally {
        await dbQuery("client", "deleteMany", { where: { id: client.id } });
      }
    });

    test("a custom LEAD status appears as its own pipeline column, and generic assignment to it never triggers WON/LOST semantics (Section E/F reverify)", async ({ page }) => {
      const customDef = await dbQuery<{ id: string; key: string }>("customStatusDefinition", "create", {
        data: {
          organizationId: fixtures.orgA.id,
          entityType: "LEAD",
          key: `nurturing_${randomUUID().slice(0, 6)}`,
          label: "Nurturing",
          color: "INFO",
          position: 99,
          isDefault: false,
          isSystem: false,
        },
      });
      const name = uniqueName();
      await dbQuery("lead", "create", { data: { name, organizationId: fixtures.orgA.id, stage: "NEW" } });

      try {
        await page.goto("/leads?view=pipeline");
        // Every ACTIVE definition (system or custom) always gets its own
        // column, empty or not — only an ARCHIVED definition needs an
        // existing Lead to earn one (pipeline-query.ts's own Section G
        // rule). "Nurturing" is active, so it's already a real, empty
        // column before any Lead is ever assigned to it.
        await expect(desktopColumn(page, "Nurturing")).toBeVisible();
        await expect(desktopColumn(page, "Nurturing").getByText(name)).toHaveCount(0);

        await moveToSelect(desktopColumn(page, "New"), name).selectOption({ label: "Nurturing" });
        await expect(page.getByText("Status updated")).toBeVisible();
        await expect(desktopColumn(page, "Nurturing").getByText(name)).toBeVisible();

        const lead = await dbQuery<{ stage: string; convertedClientId: string | null; lostReason: string | null }>(
          "lead",
          "findFirstOrThrow",
          { where: { name } },
        );
        // The CUSTOM assignment never touched `stage` — still NEW — and
        // never invoked WON conversion or LOST semantics.
        expect(lead.stage).toBe("NEW");
        expect(lead.convertedClientId).toBeNull();
        expect(lead.lostReason).toBeNull();
      } finally {
        // The Lead itself must go first — it still references this
        // definition via statusDefinitionId (Lead_statusDefinitionId_fkey).
        await dbQuery("lead", "deleteMany", { where: { name } });
        await dbQuery("customStatusDefinition", "delete", { where: { id: customDef.id } });
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

    test("a custom LEAD status column is reachable via its own nav link and usable at 390px, with no horizontal overflow (Section H)", async ({ page }) => {
      // Custom Statuses Phase 2B — Completion Pass (Section G/H): found,
      // via this very test, that the mobile switcher's own per-column nav
      // Link could never actually reach a genuinely custom column before
      // this pass — its href only ever carried `stageView: column.stage`,
      // always undefined for a custom column, silently falling back to
      // the default "NEW" tab instead of navigating anywhere. Fixed at
      // the root (view-params.ts's parseLeadStageView + this board's own
      // activeColumn lookup now also match a raw definitionId) rather
      // than worked around here — this test exercises the real fix via
      // the real nav link, not a synthetic position-ordering trick.
      const customDef = await dbQuery<{ id: string }>("customStatusDefinition", "create", {
        data: {
          organizationId: fixtures.orgA.id,
          entityType: "LEAD",
          key: `nurturing_narrow_${randomUUID().slice(0, 6)}`,
          label: "Nurturing Narrow",
          color: "INFO",
          position: 99,
          isDefault: false,
          isSystem: false,
        },
      });
      const name = uniqueName();
      await dbQuery("lead", "create", { data: { name, organizationId: fixtures.orgA.id, statusDefinitionId: customDef.id, stage: "NEW" } });

      try {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto("/leads?view=pipeline");

        await page.getByRole("link", { name: /^Nurturing Narrow/ }).click();
        await expect(page).toHaveURL(new RegExp(`stageView=${customDef.id}`));
        const customRegion = page.getByRole("region", { name: "Nurturing Narrow leads" });
        await expect(customRegion.getByText(name)).toBeVisible();

        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
        expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
      } finally {
        await dbQuery("lead", "deleteMany", { where: { name } });
        await dbQuery("customStatusDefinition", "delete", { where: { id: customDef.id } });
      }
    });
  });

  test.describe("accessibility", () => {
    test("stage movement is keyboard-reachable (a real native <select>, not a pointer-only control)", async ({ page }) => {
      const name = uniqueName();
      await dbQuery("lead", "create", { data: { name, organizationId: fixtures.orgA.id, stage: "NEW" } });
      await page.goto("/leads?view=pipeline");
      const select = moveToSelect(desktopColumn(page, "New"), name);
      await select.focus();
      await expect(select).toBeFocused();
      await select.selectOption({ label: "Contacted" });
      await expect(page.getByText("Status updated")).toBeVisible();
    });

    test("a card exposes an accessible edit link, a labeled status select, and a labeled Mark lost button", async ({ page }) => {
      const name = uniqueName();
      await dbQuery("lead", "create", { data: { name, organizationId: fixtures.orgA.id, stage: "NEW" } });
      await page.goto("/leads?view=pipeline");
      const column = desktopColumn(page, "New");
      await expect(column.getByRole("link", { name })).toHaveAttribute("href", /\/edit$/);
      await expect(moveToSelect(column, name)).toBeVisible();
      await expect(column.locator("li", { hasText: name }).getByRole("button", { name: "Mark lost" })).toBeVisible();
    });
  });

  test.describe("dark theme", () => {
    // Custom Statuses Phase 2B — Completion Pass (Section I): the
    // pipeline board itself, including a real custom-status column,
    // legible with no console errors.
    test("the board, including a custom-status column, is legible with no console errors", async ({ page, context, baseURL }) => {
      const customDef = await dbQuery<{ id: string }>("customStatusDefinition", "create", {
        data: {
          organizationId: fixtures.orgA.id,
          entityType: "LEAD",
          key: `dark_pipeline_${randomUUID().slice(0, 6)}`,
          label: "Dark Pipeline Status",
          color: "WARNING",
          position: 99,
          isDefault: false,
          isSystem: false,
        },
      });
      const name = uniqueName();
      await dbQuery("lead", "create", { data: { name, organizationId: fixtures.orgA.id, statusDefinitionId: customDef.id, stage: "NEW" } });
      await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "DARK" } });

      try {
        await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(String(e)));

        await page.goto("/leads?view=pipeline");
        await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");
        await expect(desktopColumn(page, "Dark Pipeline Status").getByText(name)).toBeVisible();

        expect(errors).toEqual([]);
      } finally {
        await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "SYSTEM" } });
        await dbQuery("lead", "deleteMany", { where: { name } });
        await dbQuery("customStatusDefinition", "delete", { where: { id: customDef.id } });
      }
    });
  });
});
