import { test, expect, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Accessibility Improvement A1 — real-keyboard coverage for RowActionMenu's
 * own WAI-ARIA menu-button behavior (Enter/Space/ArrowDown opens and
 * focuses the first enabled menuitem; Arrow/Home/End rove focus within
 * the open panel; Escape closes and returns focus to the trigger;
 * Tab/Shift+Tab are never trapped — the panel simply closes once focus
 * has genuinely left it, letting the browser's own natural document
 * order carry on uninterrupted).
 *
 * Every current Production consumer (Clients/Projects/Tasks/Invoices/
 * Contracts) renders exactly one RowActionMenuItem per menu — there is
 * no multi-item menu anywhere in this app today (confirmed by a direct
 * source audit before writing this file). Arrow/Home/End are therefore
 * exercised here against a genuine single-item menu: pressing any of
 * them must be a safe, well-defined no-op (the lone item wraps to
 * itself), never a lost-focus/crash — this still exercises the exact
 * same code path (`getMenuItems()`'s own wrap-around arithmetic) a
 * future second item would use, it just has nowhere else to go yet.
 * Manufacturing a second, fake Product action purely to exercise a
 * "real" Arrow move would be exactly the kind of consumer-side
 * expansion this slice's own brief rules out.
 *
 * Clients is the primary representative consumer (desktop); Contracts
 * is exercised too as a second, independent consumer (a different real
 * action — Archive — behind a differently-labeled trigger), satisfying
 * this slice's own "at least Clients or Contracts, plus a representative
 * Contract regression" requirement without duplicating full CRUD
 * coverage mobile-row-actions-rollout.spec.ts (Clients/Projects/Tasks)
 * and contracts-table-workflow.spec.ts (Contracts) already own —
 * this file is deliberately scoped to keyboard behavior only.
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

async function activeElementIsBody(page: Page): Promise<boolean> {
  return page.evaluate(() => document.activeElement === document.body);
}

test.beforeAll(async () => {
  fixtures = await seedE2EFixtures();
});

test.afterAll(async () => {
  await cleanupTestData(fixtures);
});

test.describe("RowActionMenu keyboard behavior — Clients (desktop, 1280px)", () => {
  let seededClientIds: string[] = [];

  async function seedClient(): Promise<{ id: string; name: string }> {
    const name = uniqueMarker("E2E-A1-Client");
    const created = await dbQuery<{ id: string; name: string }>("client", "create", {
      data: { organizationId: fixtures.orgA.id, userId: fixtures.owner.id, name },
    });
    seededClientIds.push(created.id);
    return created;
  }

  test.beforeEach(async ({ page, baseURL }) => {
    await actAsOwner(page, baseURL!);
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  test.afterEach(async () => {
    if (seededClientIds.length > 0) {
      await dbQuery("client", "deleteMany", { where: { id: { in: seededClientIds } } });
      seededClientIds = [];
    }
  });

  test("Enter on the trigger opens the menu and moves real focus to the first enabled menuitem", async ({ page }) => {
    const client = await seedClient();
    await page.goto("/clients");

    const row = page.getByRole("row", { name: new RegExp(client.name) });
    const trigger = row.getByRole("button", { name: `More actions for client ${client.name}` });
    await trigger.focus();
    await page.keyboard.press("Enter");

    await expect(page.getByRole("menu")).toBeVisible();
    const deleteItem = page.getByRole("menuitem", { name: "Delete" });
    await expect(deleteItem).toBeFocused();

    // The real, now-correct accessible role is "menuitem" — an explicit
    // ARIA role always overrides the underlying <button>'s own implicit
    // role, so the open menu's own Delete control no longer matches a
    // "button" query at all while the menu is open.
    await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
  });

  test("ArrowDown on the closed trigger opens the menu and focuses the first item", async ({ page }) => {
    const client = await seedClient();
    await page.goto("/clients");

    const row = page.getByRole("row", { name: new RegExp(client.name) });
    const trigger = row.getByRole("button", { name: `More actions for client ${client.name}` });
    await trigger.focus();
    await expect(page.getByRole("menu")).toHaveCount(0);

    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menu")).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Delete" })).toBeFocused();
  });

  test("ArrowDown/ArrowUp/Home/End on a single-item menu keep focus on that same item — never lost, never a crash", async ({
    page,
  }) => {
    const client = await seedClient();
    await page.goto("/clients");

    const row = page.getByRole("row", { name: new RegExp(client.name) });
    const trigger = row.getByRole("button", { name: `More actions for client ${client.name}` });
    await trigger.focus();
    await page.keyboard.press("Enter");

    const deleteItem = page.getByRole("menuitem", { name: "Delete" });
    await expect(deleteItem).toBeFocused();

    for (const key of ["ArrowDown", "ArrowUp", "Home", "End"]) {
      await page.keyboard.press(key);
      await expect(deleteItem).toBeFocused();
      await expect(page.getByRole("menu")).toBeVisible();
    }
  });

  test("Escape closes the menu and returns focus to the trigger", async ({ page }) => {
    const client = await seedClient();
    await page.goto("/clients");

    const row = page.getByRole("row", { name: new RegExp(client.name) });
    const trigger = row.getByRole("button", { name: `More actions for client ${client.name}` });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: "Delete" })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("Tab leaves the open menu — it closes naturally, focus is never trapped and never lost to body", async ({ page }) => {
    const client = await seedClient();
    await page.goto("/clients");

    const row = page.getByRole("row", { name: new RegExp(client.name) });
    const trigger = row.getByRole("button", { name: `More actions for client ${client.name}` });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: "Delete" })).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(page.getByRole("menu")).toHaveCount(0);
    expect(await activeElementIsBody(page)).toBe(false);
  });

  test("Shift+Tab leaves the open menu — same principle in reverse", async ({ page }) => {
    const client = await seedClient();
    await page.goto("/clients");

    const row = page.getByRole("row", { name: new RegExp(client.name) });
    const trigger = row.getByRole("button", { name: `More actions for client ${client.name}` });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: "Delete" })).toBeFocused();

    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("menu")).toHaveCount(0);
    expect(await activeElementIsBody(page)).toBe(false);
  });

  test("keyboard-activating Delete opens ConfirmDialog with its existing exact copy; Cancel preserves the client — no Product mutation", async ({
    page,
  }) => {
    const client = await seedClient();
    await page.goto("/clients");

    const row = page.getByRole("row", { name: new RegExp(client.name) });
    const trigger = row.getByRole("button", { name: `More actions for client ${client.name}` });
    await trigger.focus();
    await page.keyboard.press("Enter");

    const deleteItem = page.getByRole("menuitem", { name: "Delete" });
    await expect(deleteItem).toBeFocused();
    // Native <button> activation via the keyboard — not a .click() call —
    // proves the real control still responds to Enter/Space exactly as
    // before, despite its new role="menuitem"/tabIndex=-1.
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Delete client");
    await expect(dialog).toContainText(`Delete ${client.name}? This action cannot be undone.`);

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    await expect(page.locator("li, tr", { hasText: client.name }).first()).toBeVisible();
  });

  test("mobile (390px): pointer-opened menu still reaches Delete, and the trigger stays >=40x40px — focusing the first item on open does not break click/tap usability", async ({
    page,
  }) => {
    const client = await seedClient();
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/clients");

    const card = page.locator("li", { hasText: client.name });
    const trigger = card.getByRole("button", { name: `More actions for client ${client.name}` });
    await expect(trigger).toBeVisible();
    const triggerBox = (await trigger.boundingBox())!;
    expect(triggerBox.width).toBeGreaterThanOrEqual(40);
    expect(triggerBox.height).toBeGreaterThanOrEqual(40);

    await trigger.click();
    const deleteItem = page.getByRole("menuitem", { name: "Delete" });
    await expect(deleteItem).toBeVisible();
    await deleteItem.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
  });
});

test.describe("RowActionMenu keyboard behavior — Contracts (desktop, 1280px)", () => {
  let seededContractIds: string[] = [];

  function uniqueNumber(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  }

  async function seedContract(): Promise<{ id: string; contractNumber: string }> {
    const contractNumber = uniqueNumber("E2E-A1-C");
    const created = await dbQuery<{ id: string; contractNumber: string }>("contract", "create", {
      data: {
        title: "Accessibility A1 Test Contract",
        body: "This agreement is entered into by and between the parties.",
        status: "DRAFT",
        issueDate: "2026-06-01T00:00:00.000Z",
        organizationId: fixtures.orgA.id,
        clientId: fixtures.clientA.id,
        createdByUserId: fixtures.owner.id,
        contractNumber,
      },
    });
    seededContractIds.push(created.id);
    return created;
  }

  test.beforeEach(async ({ page, baseURL }) => {
    await actAsOwner(page, baseURL!);
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  test.afterEach(async () => {
    if (seededContractIds.length > 0) {
      await dbQuery("contract", "deleteMany", { where: { id: { in: seededContractIds } } });
      seededContractIds = [];
    }
  });

  test("Enter opens the menu and focuses Archive; Escape closes and returns focus to the trigger", async ({ page }) => {
    const contract = await seedContract();
    await page.goto("/contracts");

    const row = page.getByRole("row", { name: new RegExp(contract.contractNumber) });
    const trigger = row.getByRole("button", { name: `More actions for contract ${contract.contractNumber}` });
    await trigger.focus();
    await page.keyboard.press("Enter");

    const archiveItem = page.getByRole("menuitem", { name: "Archive" });
    await expect(archiveItem).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("Tab leaves the open Contracts menu — it closes naturally, focus is not trapped", async ({ page }) => {
    const contract = await seedContract();
    await page.goto("/contracts");

    const row = page.getByRole("row", { name: new RegExp(contract.contractNumber) });
    const trigger = row.getByRole("button", { name: `More actions for contract ${contract.contractNumber}` });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: "Archive" })).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(page.getByRole("menu")).toHaveCount(0);
    expect(await activeElementIsBody(page)).toBe(false);
  });
});
