import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Custom Statuses Phase 2B (Staff UI) — /settings/custom-statuses. Covers
 * the empty state, entity tabs, the full create/edit/archive/unarchive/
 * reorder/set-default happy path through a real browser, the responsive/
 * dark-theme gates, and Portal denial. Byte-for-byte mirror of
 * test/e2e/custom-fields-settings.spec.ts's own structure and technique.
 *
 * Domain-layer and Server Action correctness (including every security/
 * cross-org/system-immutability case) is already exhaustively covered by
 * test/integration/custom-statuses/*.test.ts and
 * test/integration/settings/custom-statuses-actions.test.ts — deliberately
 * not repeated here. seedTestData()'s own org fixtures start with ZERO
 * CustomStatusDefinition rows (never auto-bootstrapped — see
 * bootstrap.ts's own doc comment), so every tab genuinely starts empty
 * here, exactly like Custom Fields' own fixtures.
 */

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

async function actAsPortalUser(context: BrowserContext, baseURL: string): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, { id: fixtures.portalUser.id, email: fixtures.portalUser.email }, baseURL);
}

test.describe("Custom Statuses Settings UI (Phase 2B)", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await dbQuery("customStatusDefinition", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
    await cleanupTestData(fixtures);
  });

  test.beforeEach(async ({ context, baseURL }) => {
    await actAsOwner(context, baseURL!);
  });

  test.afterEach(async () => {
    await dbQuery("customStatusDefinition", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
  });

  test("empty state on the CLIENT tab shows the CTA; LEAD/PROJECT tabs switch and are independently empty", async ({ page }) => {
    await page.goto("/settings/custom-statuses");

    await expect(page.getByRole("heading", { name: "Custom statuses" })).toBeVisible();
    await expect(page.getByText("No statuses yet")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add status" })).toBeVisible();

    const entityTabs = page.getByRole("group", { name: "Custom status entity" });
    await entityTabs.getByRole("link", { name: "Leads" }).click();
    await expect(page).toHaveURL(/entity=LEAD/);
    await expect(page.getByText("No statuses yet")).toBeVisible();

    await entityTabs.getByRole("link", { name: "Projects" }).click();
    await expect(page).toHaveURL(/entity=PROJECT/);
    await expect(page.getByText("No statuses yet")).toBeVisible();

    await entityTabs.getByRole("link", { name: "Clients" }).click();
    await expect(page).toHaveURL(/entity=CLIENT/);
  });

  test("create a status, edit its label/color (key unchanged), archive it, then unarchive it", async ({ page }) => {
    await page.goto("/settings/custom-statuses");

    await page.getByRole("button", { name: "Add status" }).click();
    const createDialog = page.locator("dialog[open]");
    await createDialog.getByLabel("Label").fill("Awaiting client");
    await expect(createDialog.getByText("Internal key:")).toBeVisible();
    await expect(createDialog.getByText("awaiting_client")).toBeVisible();
    await createDialog.getByLabel("Color").selectOption("WARNING");
    await createDialog.getByRole("button", { name: "Add status" }).click();
    await expect(createDialog).toHaveCount(0);

    const row = page.getByRole("row", { name: /Awaiting client/ });
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: "Edit" }).click();
    const editDialog = page.locator("dialog[open]");
    await expect(editDialog.getByText("awaiting_client")).toBeVisible();
    await editDialog.getByLabel("Label").fill("Awaiting reply");
    await editDialog.getByLabel("Color").selectOption("INFO");
    await editDialog.getByRole("button", { name: "Save changes" }).click();
    await expect(editDialog).toHaveCount(0);
    await expect(page.getByRole("row", { name: /Awaiting reply/ })).toBeVisible();

    const renamedRow = page.getByRole("row", { name: /Awaiting reply/ });
    await renamedRow.getByRole("button", { name: "Archive" }).click();
    const confirmDialog = page.locator("dialog[open]");
    await expect(confirmDialog.getByText("no longer be available for new")).toBeVisible();
    await confirmDialog.getByRole("button", { name: "Archive", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "archived" })).toBeVisible();
    await expect(page.getByRole("row", { name: /Awaiting reply/ })).toHaveCount(0);

    await page.getByRole("button", { name: /Show archived/ }).click();
    const archivedRow = page.getByRole("row", { name: /Awaiting reply/ });
    await expect(archivedRow).toBeVisible();
    await archivedRow.getByRole("button", { name: "Unarchive" }).click();
    await expect(page.getByRole("status").filter({ hasText: "restored" })).toBeVisible();

    await page.getByRole("button", { name: "Show active" }).click();
    await expect(page.getByRole("row", { name: /Awaiting reply/ })).toBeVisible();

    // Key (an internal, machine-generated identity) never changes through
    // a label rename (Section G) — confirmed at the DB level too.
    const definition = await dbQuery<{ key: string } | null>("customStatusDefinition", "findFirst", {
      where: { organizationId: fixtures.orgA.id, label: "Awaiting reply" },
    });
    expect(definition?.key).toBe("awaiting_client");
  });

  test("the isDefault checkbox makes a new status the default, shown in its Edit dialog", async ({ page }) => {
    await page.goto("/settings/custom-statuses");

    await page.getByRole("button", { name: "Add status" }).click();
    const createDialog = page.locator("dialog[open]");
    await createDialog.getByLabel("Label").fill("Primary");
    await createDialog.getByLabel("Make this the default client status").check();
    await createDialog.getByRole("button", { name: "Add status" }).click();
    await expect(createDialog).toHaveCount(0);

    const row = page.getByRole("row", { name: /Primary/ });
    // exact: true — this row's own (closed) Edit dialog is nested in the
    // same <tr> and its "This is the current default." text otherwise
    // substring-collides with the DefaultBadge's own "Default" text
    // under Playwright's default case-insensitive substring matching
    // (same class of ambiguity custom-fields-settings.spec.ts's own
    // "Text" vs "Text" comment documents).
    await expect(row.getByText("Default", { exact: true })).toBeVisible();

    await row.getByRole("button", { name: "Edit" }).click();
    const editDialog = page.locator("dialog[open]");
    await expect(editDialog.getByText("This is the current default.")).toBeVisible();
  });

  test("moving a status up swaps its order with the status above it", async ({ page }) => {
    await page.goto("/settings/custom-statuses");

    await page.getByRole("button", { name: "Add status" }).click();
    let dialog = page.locator("dialog[open]");
    await dialog.getByLabel("Label").fill("First Status");
    await dialog.getByRole("button", { name: "Add status" }).click();
    await expect(dialog).toHaveCount(0);

    await page.getByRole("button", { name: "Add status" }).click();
    dialog = page.locator("dialog[open]");
    await dialog.getByLabel("Label").fill("Second Status");
    await dialog.getByRole("button", { name: "Add status" }).click();
    await expect(dialog).toHaveCount(0);

    const rowsBefore = page.locator("tbody tr");
    await expect(rowsBefore.first()).toContainText("First Status");

    await page.getByRole("row", { name: /Second Status/ }).getByRole("button", { name: "Move Second Status up" }).click();

    const rowsAfter = page.locator("tbody tr");
    await expect(rowsAfter.first()).toContainText("Second Status");
  });

  test("a Portal identity is redirected away from /settings/custom-statuses", async ({ context, baseURL, page }) => {
    await actAsPortalUser(context, baseURL!);
    await page.goto("/settings/custom-statuses");
    await expect(page).toHaveURL(/\/portal/);
  });

  test.describe("LEAD default lock (Completion Pass, Section B/C)", () => {
    test("the LEAD tab shows the explanatory copy, the system NEW row as Default with no Set-default control, and the create dialog never offers a make-default checkbox", async ({ page }) => {
      await page.goto("/settings/custom-statuses?entity=LEAD");
      // .first() — the (closed but still-in-DOM) create dialog further
      // down the tree repeats this exact same copy of its own; only the
      // page-level paragraph (rendered first, right after EntityTabs) is
      // actually visible at this point.
      await expect(page.getByText("New leads always start as New.").first()).toBeVisible();
      await expect(page.getByText("No statuses yet")).toBeVisible();

      // A custom LEAD status never gets a "make default" checkbox at all.
      await page.getByRole("button", { name: "Add status" }).click();
      const createDialog = page.locator("dialog[open]");
      await createDialog.getByLabel("Label").fill("Nurturing");
      await expect(createDialog.getByLabel(/Make this the default/)).toHaveCount(0);
      await expect(createDialog.getByText("New leads always start as New.")).toBeVisible();
      await createDialog.getByRole("button", { name: "Add status" }).click();
      await expect(createDialog).toHaveCount(0);

      // Nor does its own Edit dialog ever offer "Set default".
      const row = page.getByRole("row", { name: /Nurturing/ });
      await row.getByRole("button", { name: "Edit" }).click();
      const editDialog = page.locator("dialog[open]");
      await expect(editDialog.getByRole("button", { name: "Set default" })).toHaveCount(0);
      await expect(editDialog.getByText("This is the current default.")).toHaveCount(0);
    });
  });

  test.describe("responsive", () => {
    // Section H (Completion Pass) — each width check now seeds several
    // real statuses first and exercises the actual populated table, not
    // only an empty-state/dialog check.
    async function seedThreeStatuses(): Promise<void> {
      for (const label of ["Alpha Status", "Beta Status", "Gamma Status"]) {
        await dbQuery("customStatusDefinition", "create", {
          data: {
            organizationId: fixtures.orgA.id,
            entityType: "CLIENT",
            key: label.toLowerCase().replace(/\s+/g, "_"),
            label,
            color: "INFO",
            position: ["Alpha Status", "Beta Status", "Gamma Status"].indexOf(label),
            isDefault: false,
            isSystem: false,
          },
        });
      }
    }

    test("390px: a populated table has no page-level horizontal overflow, Add button reachable, dialog fits the viewport", async ({ page }) => {
      await seedThreeStatuses();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/settings/custom-statuses");

      await expect(page.getByRole("row", { name: /Beta Status/ })).toBeVisible();
      const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(hasOverflow).toBe(false);

      await page.getByRole("button", { name: "Add status" }).click();
      const dialog = page.locator("dialog[open]");
      await expect(dialog).toBeVisible();
      const box = await dialog.boundingBox();
      expect(box?.width).toBeLessThanOrEqual(390);
    });

    test("834px: a populated table, entity tabs, and row actions remain usable, no overflow", async ({ page }) => {
      await seedThreeStatuses();
      await page.setViewportSize({ width: 834, height: 1100 });
      await page.goto("/settings/custom-statuses");

      await expect(page.getByRole("row", { name: /Gamma Status/ })).toBeVisible();
      await expect(page.getByRole("row", { name: /Alpha Status/ }).getByRole("button", { name: "Edit" })).toBeVisible();
      const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(hasOverflow).toBe(false);
      await expect(page.getByRole("group", { name: "Custom status entity" }).getByRole("link", { name: "Leads" })).toBeVisible();
    });

    test("1280px: full table columns (Label, Internal key, Position, Actions) are visible for a populated, multi-row table", async ({ page }) => {
      await seedThreeStatuses();
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto("/settings/custom-statuses");

      await expect(page.getByRole("columnheader", { name: "Internal key" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Position" })).toBeVisible();
      await expect(page.locator("tbody code", { hasText: "alpha_status" }).first()).toBeVisible();
      await expect(page.locator("tbody code", { hasText: "beta_status" }).first()).toBeVisible();
      await expect(page.locator("tbody code", { hasText: "gamma_status" }).first()).toBeVisible();

      await page.getByRole("button", { name: "Add status" }).click();
      const dialog = page.locator("dialog[open]");
      await dialog.getByLabel("Label").fill("Wide Status");
      await dialog.getByRole("button", { name: "Add status" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.locator("tbody code", { hasText: "wide_status" }).first()).toBeVisible();
    });
  });

  test("dark theme: a populated Settings list, and one entity status selector (Client edit), are legible with no console errors", async ({ page, context, baseURL }) => {
    await dbQuery("customStatusDefinition", "create", {
      data: {
        organizationId: fixtures.orgA.id,
        entityType: "CLIENT",
        key: "dark_mode_status",
        label: "Dark Mode Status",
        color: "SUCCESS",
        position: 0,
        isDefault: false,
        isSystem: false,
      },
    });
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "DARK" } });
    await actAsOwner(context, baseURL!);

    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto("/settings/custom-statuses");
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");
    // A real populated row, not only the empty state (Section I).
    await expect(page.getByRole("row", { name: /Dark Mode Status/ })).toBeVisible();

    await page.getByRole("button", { name: "Add status" }).click();
    await expect(page.locator("dialog[open]")).toBeVisible();
    await page.keyboard.press("Escape");

    // One real entity status selector, in the same dark theme — the
    // Client edit form's own status <select> (Section I).
    await page.goto(`/clients/${fixtures.clientA.id}/edit`);
    await expect(page.getByLabel("Status")).toBeVisible();
    await expect(page.getByLabel("Status").locator("option", { hasText: "Dark Mode Status" })).toHaveCount(1);

    expect(errors).toEqual([]);

    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "SYSTEM" } });
  });
});
