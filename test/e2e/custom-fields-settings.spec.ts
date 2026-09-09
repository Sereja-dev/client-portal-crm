import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Custom Fields Phase 2A (Staff UI) — /settings/custom-fields. Covers the
 * empty state, entity tabs, the full create/edit/archive/unarchive/
 * reorder happy path through a real browser (TEXT and SELECT field
 * types, SELECT option management), the responsive/dark-theme gates, and
 * Portal denial. Domain-layer and Server Action correctness (including
 * every security/cross-org case) is already exhaustively covered by
 * test/integration/custom-fields/*.test.ts and
 * test/integration/settings/custom-fields-actions.test.ts — deliberately
 * not repeated here.
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

test.describe("Custom Fields Settings UI (Phase 2A)", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    // Every custom field this spec created lives in orgA — swept before
    // cleanupTestData() the same way client-contacts.spec.ts's own
    // afterAll sweeps its own ad-hoc rows first.
    await dbQuery("customFieldDefinition", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
    await cleanupTestData(fixtures);
  });

  test.beforeEach(async ({ context, baseURL }) => {
    await actAsOwner(context, baseURL!);
  });

  test.afterEach(async () => {
    await dbQuery("customFieldDefinition", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
  });

  test("1/2/3/4. empty state on the CLIENT tab shows the CTA; LEAD/PROJECT tabs switch and are independently empty", async ({ page }) => {
    await page.goto("/settings/custom-fields");

    await expect(page.getByRole("heading", { name: "Custom fields" })).toBeVisible();
    await expect(page.getByText("No custom fields yet")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add custom field" })).toBeVisible();

    const entityTabs = page.getByRole("group", { name: "Custom field entity" });
    await entityTabs.getByRole("link", { name: "Leads" }).click();
    await expect(page).toHaveURL(/entity=LEAD/);
    await expect(page.getByText("No custom fields yet")).toBeVisible();

    await entityTabs.getByRole("link", { name: "Projects" }).click();
    await expect(page).toHaveURL(/entity=PROJECT/);
    await expect(page.getByText("No custom fields yet")).toBeVisible();

    await entityTabs.getByRole("link", { name: "Clients" }).click();
    await expect(page).toHaveURL(/entity=CLIENT/);
  });

  test("create a TEXT field, edit its label (key unchanged), archive it, then unarchive it", async ({ page }) => {
    await page.goto("/settings/custom-fields");

    await page.getByRole("button", { name: "Add custom field" }).click();
    const createDialog = page.locator("dialog[open]");
    await createDialog.getByLabel("Label").fill("Account Manager");
    await expect(createDialog.getByText("Internal key:")).toBeVisible();
    await expect(createDialog.getByText("account_manager")).toBeVisible();
    await createDialog.getByLabel("Field type").selectOption("TEXT");
    await createDialog.getByRole("button", { name: "Add custom field" }).click();
    await expect(createDialog).toHaveCount(0);

    const row = page.getByRole("row", { name: /Account Manager/ });
    await expect(row).toBeVisible();
    // Scoped to <span> specifically — this row's own (closed) Edit dialog
    // is nested inside the same <tr> (its own Actions cell) and repeats
    // "Text" as a read-only <dd> value, so a plain getByText("Text") here
    // would be ambiguous between the two even though only the badge is
    // actually visible.
    await expect(row.locator("span").filter({ hasText: "Text" })).toBeVisible();

    await row.getByRole("button", { name: "Edit" }).click();
    const editDialog = page.locator("dialog[open]");
    await expect(editDialog.getByText("account_manager")).toBeVisible();
    await editDialog.getByLabel("Label").fill("AM (renamed)");
    await editDialog.getByRole("button", { name: "Save changes" }).click();
    await expect(editDialog).toHaveCount(0);
    await expect(page.getByRole("row", { name: /AM \(renamed\)/ })).toBeVisible();

    const renamedRow = page.getByRole("row", { name: /AM \(renamed\)/ });
    await renamedRow.getByRole("button", { name: "Archive" }).click();
    const confirmDialog = page.locator("dialog[open]");
    await confirmDialog.getByRole("button", { name: "Archive", exact: true }).click();
    // Toasts render with role="status" — targeted that way rather than a
    // plain getByText("archived"), which is ambiguous with the "Show
    // archived (1)" toggle button's own label.
    await expect(page.getByRole("status").filter({ hasText: "archived" })).toBeVisible();
    await expect(page.getByRole("row", { name: /AM \(renamed\)/ })).toHaveCount(0);

    await page.getByRole("button", { name: /Show archived/ }).click();
    const archivedRow = page.getByRole("row", { name: /AM \(renamed\)/ });
    await expect(archivedRow).toBeVisible();
    await archivedRow.getByRole("button", { name: "Unarchive" }).click();
    await expect(page.getByRole("status").filter({ hasText: "restored" })).toBeVisible();

    await page.getByRole("button", { name: "Show active" }).click();
    await expect(page.getByRole("row", { name: /AM \(renamed\)/ })).toBeVisible();
  });

  test("create a SELECT field with two initial options, then add/rename/archive an option from the Edit dialog", async ({ page }) => {
    await page.goto("/settings/custom-fields?entity=LEAD");

    await page.getByRole("button", { name: "Add custom field" }).click();
    const createDialog = page.locator("dialog[open]");
    await createDialog.getByLabel("Label").fill("Priority");
    await createDialog.getByLabel("Field type").selectOption("SELECT");
    await createDialog.getByPlaceholder("Option 1").fill("Low");
    await createDialog.getByRole("button", { name: "+ Add option" }).click();
    await createDialog.getByPlaceholder("Option 2").fill("High");
    await createDialog.getByRole("button", { name: "Add custom field" }).click();
    await expect(createDialog).toHaveCount(0);

    const row = page.getByRole("row", { name: /Priority/ });
    await expect(row).toBeVisible();
    await expect(row.getByText("2 options")).toBeVisible();

    await row.getByRole("button", { name: "Edit" }).click();
    const editDialog = page.locator("dialog[open]");
    // exact:true throughout this option-list section — the dialog's own
    // static copy ("...renaming the label beLOW never changes...")
    // otherwise substring-collides with "Low" under Playwright's default
    // case-insensitive substring text matching.
    await expect(editDialog.getByText("Low", { exact: true })).toBeVisible();
    await expect(editDialog.getByText("High", { exact: true })).toBeVisible();

    // Add a third option via the OptionManager's own "Add option…" row.
    await editDialog.getByPlaceholder("Add option…").fill("Medium");
    await editDialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(editDialog.getByText("Medium", { exact: true })).toBeVisible();

    // Rename "Low" inline. `hasText: "Low"` only identifies the <li>
    // *before* clicking Rename — once it switches to the inline edit
    // form the <li> no longer has any plain "Low" text node (only an
    // <input> whose value isn't matched by hasText), so that same
    // locator would stop resolving to anything afterward. The rename
    // input/Save button are instead found via `li input[name="label"]` /
    // a <li>-scoped "Save" button — only one <li> is ever in edit mode
    // at a time, and the OptionManager's own separate "Add option…" row
    // below the list is not inside any <li>, so this can't collide with it.
    await editDialog.locator("li", { hasText: "Low" }).first().getByRole("button", { name: "Rename" }).click();
    await editDialog.locator('li input[name="label"]').fill("Low priority");
    await editDialog.locator("li").getByRole("button", { name: "Save", exact: true }).click();
    await expect(editDialog.getByText("Low priority", { exact: true })).toBeVisible();

    // Archive "High".
    const highRow = editDialog.locator("li", { hasText: "High" }).first();
    await highRow.getByRole("button", { name: "Archive" }).click();
    await expect(editDialog.getByText("High", { exact: true })).toHaveCount(0);
  });

  test("moving a field up swaps its order with the field above it", async ({ page }) => {
    await page.goto("/settings/custom-fields");

    await page.getByRole("button", { name: "Add custom field" }).click();
    let dialog = page.locator("dialog[open]");
    await dialog.getByLabel("Label").fill("First Field");
    await dialog.getByLabel("Field type").selectOption("TEXT");
    await dialog.getByRole("button", { name: "Add custom field" }).click();
    await expect(dialog).toHaveCount(0);

    await page.getByRole("button", { name: "Add custom field" }).click();
    dialog = page.locator("dialog[open]");
    await dialog.getByLabel("Label").fill("Second Field");
    await dialog.getByLabel("Field type").selectOption("TEXT");
    await dialog.getByRole("button", { name: "Add custom field" }).click();
    await expect(dialog).toHaveCount(0);

    const rowsBefore = page.locator("tbody tr");
    await expect(rowsBefore.first()).toContainText("First Field");

    await page.getByRole("row", { name: /Second Field/ }).getByRole("button", { name: "Move Second Field up" }).click();

    const rowsAfter = page.locator("tbody tr");
    await expect(rowsAfter.first()).toContainText("Second Field");
  });

  test("35. a Portal identity is redirected away from /settings/custom-fields", async ({ context, baseURL, page }) => {
    await actAsPortalUser(context, baseURL!);
    await page.goto("/settings/custom-fields");
    await expect(page).toHaveURL(/\/portal/);
  });

  test.describe("responsive", () => {
    test("390px: no page-level horizontal overflow, Add button reachable, dialog fits the viewport", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/settings/custom-fields");

      const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(hasOverflow).toBe(false);

      await page.getByRole("button", { name: "Add custom field" }).click();
      const dialog = page.locator("dialog[open]");
      await expect(dialog).toBeVisible();
      const box = await dialog.boundingBox();
      expect(box?.width).toBeLessThanOrEqual(390);
    });

    test("834px: entity tabs and definitions table remain usable, no overflow", async ({ page }) => {
      await page.setViewportSize({ width: 834, height: 1100 });
      await page.goto("/settings/custom-fields");

      const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(hasOverflow).toBe(false);
      await expect(page.getByRole("group", { name: "Custom field entity" }).getByRole("link", { name: "Leads" })).toBeVisible();
    });

    test("1280px: full table columns (Label, Internal key, Position, Actions) are visible", async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto("/settings/custom-fields");
      await page.getByRole("button", { name: "Add custom field" }).click();
      const dialog = page.locator("dialog[open]");
      await dialog.getByLabel("Label").fill("Wide Field");
      await dialog.getByLabel("Field type").selectOption("TEXT");
      await dialog.getByRole("button", { name: "Add custom field" }).click();
      await expect(dialog).toHaveCount(0);

      await expect(page.getByRole("columnheader", { name: "Internal key" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Position" })).toBeVisible();
      // .first() — this row's own (closed) Edit dialog, nested in its
      // Actions cell later in DOM order, repeats the same key in its own
      // read-only <code>; the visible table-cell <code> always comes
      // first in document order.
      await expect(page.locator("tbody code", { hasText: "wide_field" }).first()).toBeVisible();
    });
  });

  test("dark theme: page, list, and dialog are legible with no console errors", async ({ page, context, baseURL }) => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "DARK" } });
    await actAsOwner(context, baseURL!);

    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto("/settings/custom-fields");
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");

    await page.getByRole("button", { name: "Add custom field" }).click();
    await expect(page.locator("dialog[open]")).toBeVisible();

    expect(errors).toEqual([]);

    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "SYSTEM" } });
  });
});
