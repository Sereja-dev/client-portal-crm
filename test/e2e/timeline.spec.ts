import { randomUUID } from "node:crypto";
import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Communication Timeline Phase 2 — Staff UI on the Client and Lead edit
 * pages: add/edit/delete a note, Activity events rendering meaningfully,
 * and responsive behavior at 1280/834/390px. Domain-layer/Server Action
 * correctness (tenant isolation, edit/delete permissions, ordering,
 * side-effect isolation) is already exhaustively covered by
 * test/integration/timeline/*.test.ts — deliberately not repeated here.
 */

let fixtures: TestFixtures;

// Custom Statuses Phase 2B — Completion Pass (Section G): see leads.spec.ts's
// own identical helper/comment — the generic "Change status" select
// (lead-actions-panel.tsx) sources its options from this org's own real
// CustomStatusDefinition rows, and seedE2EFixtures()'s own org fixture is
// never auto-bootstrapped. Needed here (Lead Timeline Activity formatting
// fix) so a real stage move can be driven through the real UI control.
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

test.describe("Communication Timeline — Staff UI", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
    // Custom Statuses Phase 2B (Section G) — see tags.spec.ts's own
    // identical comment: the Client edit form requires a real
    // statusDefinitionId, and seedE2EFixtures()'s own org fixture starts
    // with zero CustomStatusDefinition rows on purpose.
    await dbQuery("customStatusDefinition", "create", {
      data: {
        organizationId: fixtures.orgA.id,
        entityType: "CLIENT",
        key: "lead",
        label: "Lead",
        color: "NEUTRAL",
        position: 0,
        isDefault: true,
        isSystem: true,
      },
    });
    await bootstrapLeadStatuses(fixtures.orgA.id);
  });

  test.afterAll(async () => {
    await dbQuery("timelineNote", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
    await dbQuery("customStatusDefinition", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
    await cleanupTestData(fixtures);
  });

  test.beforeEach(async ({ context, baseURL }) => {
    await actAsOwner(context, baseURL!);
  });

  test.afterEach(async () => {
    await dbQuery("timelineNote", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
    await dbQuery("lead", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
  });

  test("Client edit: Timeline is visible, a note can be added, appears, is edited, then deleted — the page stays on /clients/{id}/edit throughout", async ({ page }) => {
    await page.goto(`/clients/${fixtures.clientA.id}/edit`);
    await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
    await expect(page.getByText("Activity and staff notes")).toBeVisible();

    // Existing Activity (the Client's own CREATED event) renders meaningfully.
    await expect(page.getByText(new RegExp(`created client ${fixtures.clientA.name}`))).toBeVisible();

    await page.getByLabel("Note", { exact: true }).fill("Called about renewal.");
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(page.getByText("Called about renewal.")).toBeVisible();
    await expect(page).toHaveURL(`/clients/${fixtures.clientA.id}/edit`);

    // Edit the note inline.
    const noteRow = page.locator("li", { hasText: "Called about renewal." });
    await noteRow.getByRole("button", { name: "Edit" }).click();
    // Scoped to the note's own row — the top-level "Add note" composer's
    // own "Note"-labeled textarea is still present elsewhere on the page.
    await noteRow.getByLabel("Note", { exact: true }).fill("Called about renewal — client will decide next week.");
    await noteRow.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Called about renewal — client will decide next week.")).toBeVisible();
    await expect(page.getByText("(edited)")).toBeVisible();
    await expect(page).toHaveURL(`/clients/${fixtures.clientA.id}/edit`);

    // Delete the note.
    const editedRow = page.locator("li", { hasText: "will decide next week" });
    await editedRow.getByRole("button", { name: "Delete" }).click();
    const dialog = page.locator("dialog[open]");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText("will decide next week")).toHaveCount(0);
    await expect(page).toHaveURL(`/clients/${fixtures.clientA.id}/edit`);
  });

  test("Lead edit: a note can be added and appears, and the Lead's own CREATED activity renders meaningfully", async ({ page }) => {
    const lead = await dbQuery<{ id: string; name: string }>("lead", "create", {
      data: { name: `Timeline Lead ${randomUUID().slice(0, 6)}`, organizationId: fixtures.orgA.id },
    });
    // The Lead's own CREATED Activity is only written by createLeadAction
    // (the real Staff create flow) — write one directly here so this
    // test can assert on real, formatted LEAD Activity rendering without
    // driving the full create form.
    await dbQuery("activity", "create", {
      data: {
        organizationId: fixtures.orgA.id,
        actorId: fixtures.owner.id,
        entityType: "LEAD",
        entityId: lead.id,
        action: "CREATED",
        metadata: { name: lead.name, stage: "NEW", actorName: fixtures.owner.name },
      },
    });

    await page.goto(`/leads/${lead.id}/edit`);
    await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
    await expect(page.getByText(new RegExp(`created lead ${lead.name}`))).toBeVisible();

    await page.getByLabel("Note", { exact: true }).fill("Sent a proposal.");
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(page.getByText("Sent a proposal.")).toBeVisible();
    await expect(page).toHaveURL(`/leads/${lead.id}/edit`);

    // Lead Timeline Activity formatting fix — a real stage move (the
    // Lead's own "Change status" control, driving the real
    // moveLeadStageAction) now renders meaningfully instead of the
    // generic "Activity recorded" fallback. Exercised through the real
    // producer, not a hand-constructed Activity row.
    await page.getByLabel("Change status").selectOption({ label: "Qualified" });
    await expect(page.getByText("Status updated")).toBeVisible();
    await expect(page.getByText(new RegExp(`changed lead ${lead.name} status`))).toBeVisible();
    await expect(page.getByText("New → Qualified")).toBeVisible();
    await expect(page.getByText("Activity recorded")).toHaveCount(0);
  });

  test.describe("responsive", () => {
    test("Client edit Timeline at 1280px: no destructive horizontal overflow, controls reachable", async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/clients/${fixtures.clientA.id}/edit`);
      await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
      const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(hasOverflow).toBe(false);
      await expect(page.getByRole("button", { name: "Add note" })).toBeVisible();
    });

    test("Client edit Timeline at 834px: no destructive horizontal overflow, textarea fits, controls reachable", async ({ page }) => {
      await page.setViewportSize({ width: 834, height: 1100 });
      await page.goto(`/clients/${fixtures.clientA.id}/edit`);
      await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
      const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(hasOverflow).toBe(false);
      const textarea = page.getByLabel("Note", { exact: true });
      const box = await textarea.boundingBox();
      expect(box?.width).toBeLessThanOrEqual(834);
    });

    test("Client edit Timeline at 390px: no destructive horizontal overflow, a long note wraps, controls remain reachable", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/clients/${fixtures.clientA.id}/edit`);
      await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();

      const longNote =
        "This is a deliberately long note body meant to exercise text wrapping at a narrow mobile viewport width without ever forcing the page itself to scroll sideways.";
      await page.getByLabel("Note", { exact: true }).fill(longNote);
      await page.getByRole("button", { name: "Add note" }).click();
      await expect(page.getByText(longNote)).toBeVisible();

      const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(hasOverflow).toBe(false);

      const noteRow = page.locator("li", { hasText: longNote });
      await expect(noteRow.getByRole("button", { name: "Edit" })).toBeVisible();
      await expect(noteRow.getByRole("button", { name: "Delete" })).toBeVisible();
    });

    test("Lead edit Timeline at 390px: no destructive horizontal overflow, existing Lead controls (Tags/Custom Fields/LeadActionsPanel) remain intact", async ({ page }) => {
      const lead = await dbQuery<{ id: string; name: string }>("lead", "create", {
        data: { name: `Mobile Lead ${randomUUID().slice(0, 6)}`, organizationId: fixtures.orgA.id },
      });

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/leads/${lead.id}/edit`);

      await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Name", exact: true })).toBeVisible();
      const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(hasOverflow).toBe(false);
    });
  });
});
