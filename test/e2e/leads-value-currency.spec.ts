import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Lead Value Currency Correctness fix — a genuine, real-browser proof
 * that the actual JSX wiring (leads/page.tsx's own resolveReportsCurrency
 * call, its two List format call sites, and the currency prop threaded
 * through LeadPipelineBoard -> LeadPipelineCard) really works end to end,
 * complementing test/unit/leads/lead-value-currency.test.ts (the pure
 * formatLeadValue logic, including the null-currency "—" branch this
 * fixture's own always-USD invoice can never reach) and
 * test/integration/leads/value-currency.test.ts (the real
 * resolveReportsCurrency + formatLeadValue chain against a fresh,
 * currency-controlled organization). fixtures.orgA's own single seeded
 * Invoice has no explicit currency, so it defaults to the schema's own
 * "USD" — this file deliberately never mutates that (the EUR/null
 * scenarios are already fully, deterministically covered at the lower
 * levels above) and only proves the real render for the USD case: does
 * the currency this page resolves actually reach every one of the three
 * real call sites correctly, with no prop-name typo or wiring mistake.
 *
 * Leads Pipeline V1 (Section 4) — the List-specific navigations below
 * now say `view=list` explicitly, since Pipeline (not List) is what an
 * omitted `view` param resolves to as of that phase.
 */

// Byte-for-byte copy of test/e2e/leads-pipeline.spec.ts's own
// bootstrapLeadStatuses — seedE2EFixtures()'s own org fixture is never
// auto-bootstrapped with LEAD CustomStatusDefinition rows (see that
// file's own header comment), so the Pipeline board has zero columns
// (and therefore never shows any Lead at all) without this.
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

async function actAsOwner(context: BrowserContext, baseURL: string): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, fixtures.owner, baseURL);
  await context.addCookies([
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

test.describe("Lead value currency — real render (USD, fixtures.orgA's own real resolved currency)", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
    await bootstrapLeadStatuses(fixtures.orgA.id);
  });

  test.afterAll(async () => {
    await dbQuery("customStatusDefinition", "deleteMany", { where: { organizationId: fixtures.orgA.id, entityType: "LEAD" } });
    await cleanupTestData(fixtures);
  });

  test.beforeEach(async ({ context, baseURL }) => {
    await actAsOwner(context, baseURL!);
  });

  test("List desktop table renders a Lead's value in $, not an unformatted number or a different currency", async ({ page }) => {
    const lead = await dbQuery<{ id: string; name: string }>("lead", "create", {
      data: { organizationId: fixtures.orgA.id, name: `E2E Currency Lead ${Date.now()}`, value: "1234.56" },
    });
    try {
      await page.goto("/leads?view=list");
      const row = page.getByRole("row", { name: new RegExp(lead.name) });
      await expect(row).toBeVisible();
      await expect(row).toContainText("$1,234.56");
    } finally {
      await dbQuery("lead", "deleteMany", { where: { id: lead.id } });
    }
  });

  test("List mobile record-card path renders the same $ value, not the formatter's own USD-default-without-a-check regressing silently", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const lead = await dbQuery<{ id: string; name: string }>("lead", "create", {
      data: { organizationId: fixtures.orgA.id, name: `E2E Mobile Currency Lead ${Date.now()}`, value: "987.65" },
    });
    try {
      await page.goto("/leads?view=list");
      // Both the desktop <table> row and the mobile <RecordCard> render
      // in the DOM simultaneously (toggled by a CSS breakpoint, not
      // conditional rendering) — scoped to the mobile RecordCardList's
      // own <li role="listitem"> so this genuinely exercises the mobile
      // record-card render path, not an ambiguous match against both.
      const card = page.getByRole("listitem").filter({ hasText: lead.name });
      await expect(card).toBeVisible();
      await expect(card).toContainText("$987.65");
    } finally {
      await dbQuery("lead", "deleteMany", { where: { id: lead.id } });
    }
  });

  test("Pipeline card renders the same $ value, proving the currency prop actually reaches LeadPipelineBoard -> LeadPipelineCard", async ({ page }) => {
    const lead = await dbQuery<{ id: string; name: string }>("lead", "create", {
      data: { organizationId: fixtures.orgA.id, name: `E2E Pipeline Currency Lead ${Date.now()}`, value: "42.00" },
    });
    try {
      await page.goto("/leads?view=pipeline");
      const card = page.getByRole("listitem").filter({ hasText: lead.name });
      await expect(card).toBeVisible();
      await expect(card).toContainText("$42.00");
    } finally {
      await dbQuery("lead", "deleteMany", { where: { id: lead.id } });
    }
  });

  test("a Lead with no value still renders '—' on List, and the whole Value row stays omitted on Pipeline (unchanged pre-fix behavior)", async ({ page }) => {
    const lead = await dbQuery<{ id: string; name: string }>("lead", "create", {
      data: { organizationId: fixtures.orgA.id, name: `E2E No-Value Lead ${Date.now()}` },
    });
    try {
      await page.goto("/leads?view=list");
      const row = page.getByRole("row", { name: new RegExp(lead.name) });
      await expect(row).toBeVisible();
      await expect(row).toContainText("—");

      await page.goto("/leads?view=pipeline");
      const card = page.getByRole("listitem").filter({ hasText: lead.name });
      await expect(card).toBeVisible();
      await expect(card).not.toContainText("$");
    } finally {
      await dbQuery("lead", "deleteMany", { where: { id: lead.id } });
    }
  });
});
