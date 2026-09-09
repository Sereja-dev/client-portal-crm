import { randomUUID } from "node:crypto";
import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Custom Fields Phase 2B (Entity Values UI) — user-level flows through a
 * real browser for Client/Lead/Project create+edit with real custom
 * field definitions, required-field validation blocking save, SELECT
 * (active + archived historical option), responsive, and dark theme.
 * Domain-layer/Server Action correctness (every field type, every
 * required rule, every archived/security/transaction case) is already
 * exhaustively covered by test/integration/{clients,leads,projects}/
 * custom-fields-form.test.ts — deliberately not repeated here.
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

type SeededDefinition = { id: string; key: string };

async function seedDefinition(
  entityType: "CLIENT" | "LEAD" | "PROJECT",
  fieldType: "TEXT" | "NUMBER" | "DATE" | "CHECKBOX" | "SELECT",
  label: string,
  opts: { required?: boolean; position?: number } = {},
): Promise<SeededDefinition> {
  const key = `${label.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${randomUUID().slice(0, 6)}`;
  const created = await dbQuery<{ id: string }>("customFieldDefinition", "create", {
    data: {
      organizationId: fixtures.orgA.id,
      entityType,
      key,
      label,
      fieldType,
      required: opts.required ?? false,
      position: opts.position ?? 0,
    },
  });
  return { id: created.id, key };
}

async function seedOption(definitionId: string, label: string, position: number): Promise<{ id: string }> {
  const value = `${label.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${randomUUID().slice(0, 6)}`;
  return dbQuery<{ id: string }>("customFieldOption", "create", { data: { definitionId, label, value, position } });
}

async function archiveOption(optionId: string): Promise<void> {
  await dbQuery("customFieldOption", "update", { where: { id: optionId }, data: { archivedAt: new Date().toISOString() } });
}

/**
 * Every list page (Clients/Leads/Projects) renders the record's own name
 * as plain text, never as a link — only a separate "Edit" pencil-icon
 * link exists, scoped per row. Clicking a record's edit page therefore
 * always goes through its own <tr role="row"> first.
 */
async function goToEdit(page: import("@playwright/test").Page, recordName: string): Promise<void> {
  await page.getByRole("row", { name: recordName }).getByRole("link", { name: "Edit" }).click();
}

test.describe("Custom Fields — Entity Values UI (Phase 2B)", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await dbQuery("customFieldDefinition", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
    await cleanupTestData(fixtures);
  });

  test.beforeEach(async ({ context, baseURL }) => {
    await actAsOwner(context, baseURL!);
  });

  test.afterEach(async () => {
    await dbQuery("customFieldDefinition", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
    await dbQuery("client", "deleteMany", { where: { organizationId: fixtures.orgA.id, id: { not: fixtures.clientA.id } } });
    await dbQuery("lead", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
    await dbQuery("project", "deleteMany", { where: { organizationId: fixtures.orgA.id, id: { not: fixtures.project.id } } });
  });

  test("Client: create with custom values, edit shows them prefilled, change + clear + save, reopen confirms", async ({ page }) => {
    const textDef = await seedDefinition("CLIENT", "TEXT", "Account Manager", { position: 0 });
    const numberDef = await seedDefinition("CLIENT", "NUMBER", "Deal Size", { position: 1 });

    await page.goto("/clients/new");
    await expect(page.getByText("Custom fields", { exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Custom Field E2E Client");
    await page.getByLabel("Account Manager").fill("Jane Doe");
    await page.getByLabel("Deal Size").fill("5000");
    await page.getByRole("button", { name: "Create client" }).click();

    await expect(page).toHaveURL(/\/clients/);
    await goToEdit(page, "Custom Field E2E Client");
    await expect(page).toHaveURL(/\/clients\/.+\/edit/);

    await expect(page.getByLabel("Account Manager")).toHaveValue("Jane Doe");
    await expect(page.getByLabel("Deal Size")).toHaveValue("5000");

    // Change TEXT, clear NUMBER (optional).
    await page.getByLabel("Account Manager").fill("John Smith");
    await page.getByLabel("Deal Size").fill("");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page).toHaveURL(/\/clients/);
    await goToEdit(page, "Custom Field E2E Client");
    await expect(page.getByLabel("Account Manager")).toHaveValue("John Smith");
    await expect(page.getByLabel("Deal Size")).toHaveValue("");

    void textDef;
    void numberDef;
  });

  test("Lead: create/edit with a representative custom field", async ({ page }) => {
    await seedDefinition("LEAD", "TEXT", "Referral Source", { position: 0 });

    await page.goto("/leads/new");
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Custom Field E2E Lead");
    await page.getByLabel("Referral Source").fill("Conference");
    await page.getByRole("button", { name: "Create lead" }).click();
    await expect(page).toHaveURL(/\/leads/);

    await goToEdit(page, "Custom Field E2E Lead");
    await expect(page.getByLabel("Referral Source")).toHaveValue("Conference");
    await page.getByLabel("Referral Source").fill("Cold outreach");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(/\/leads/);
  });

  test("Project: create/edit with a representative custom field", async ({ page }) => {
    await seedDefinition("PROJECT", "DATE", "Kickoff Target", { position: 0 });

    await page.goto("/projects/new");
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Custom Field E2E Project");
    await page.getByRole("combobox", { name: "Client", exact: true }).selectOption(fixtures.clientA.id);
    await page.getByLabel("Kickoff Target").fill("2026-09-01");
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL(/\/projects/);

    await goToEdit(page, "Custom Field E2E Project");
    await expect(page.getByLabel("Kickoff Target")).toHaveValue("2026-09-01");
  });

  test("required field blocks save with a visible field error", async ({ page }) => {
    await seedDefinition("CLIENT", "TEXT", "Required Note", { required: true, position: 0 });

    await page.goto("/clients/new");
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Required Field E2E Client");
    await page.getByRole("button", { name: "Create client" }).click();

    // Blocked — still on the create page, with a visible field error.
    await expect(page).toHaveURL(/\/clients\/new/);
    await expect(page.getByText("This field is required.")).toBeVisible();

    // React resets every uncontrolled field after a useActionState action
    // completes, success or failure (a native-form-reset-like behavior,
    // not specific to Custom Fields) — the Name field needs refilling
    // too, exactly as a real visitor retrying this form would have to.
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Required Field E2E Client");
    await page.getByLabel("Required Note").fill("Now provided");
    await page.getByRole("button", { name: "Create client" }).click();
    await expect(page).toHaveURL(/\/clients/);
    await expect(page).not.toHaveURL(/\/clients\/new/);
  });

  test("SELECT: active options work; an archived historical selection is shown, kept unchanged, and not offered for fresh selection", async ({ page }) => {
    const def = await seedDefinition("CLIENT", "SELECT", "Tier", { position: 0 });
    const gold = await seedOption(def.id, "Gold", 0);
    const legacy = await seedOption(def.id, "Legacy Bronze", 1);

    // Create a Client selecting the (still-active) "Legacy Bronze" option.
    await page.goto("/clients/new");
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Select E2E Client");
    await page.getByLabel("Tier").selectOption({ label: "Legacy Bronze" });
    await page.getByRole("button", { name: "Create client" }).click();
    await expect(page).toHaveURL(/\/clients/);

    // Now archive that option out from under the existing selection.
    await archiveOption(legacy.id);

    await goToEdit(page, "Select E2E Client");
    const select = page.getByLabel("Tier");
    await expect(select).toHaveValue(legacy.id);
    await expect(select.locator("option", { hasText: "Legacy Bronze (archived)" })).toHaveCount(1);

    // Saving unchanged succeeds.
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(/\/clients/);

    // Reopen: still shows the historical archived selection.
    await goToEdit(page, "Select E2E Client");
    await expect(page.getByLabel("Tier")).toHaveValue(legacy.id);

    // Change away to the active option — the archived option must then
    // disappear from the list entirely (can't be reselected).
    await page.getByLabel("Tier").selectOption({ label: "Gold" });
    await expect(page.getByLabel("Tier").locator("option", { hasText: "archived" })).toHaveCount(0);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(/\/clients/);

    void gold;
  });

  test.describe("responsive", () => {
    test("390px: Client edit form's custom fields fit with no horizontal overflow", async ({ page }) => {
      await seedDefinition("CLIENT", "TEXT", "Narrow Field", { position: 0 });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/clients/${fixtures.clientA.id}/edit`);
      await expect(page.getByLabel("Narrow Field")).toBeVisible();
      const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(hasOverflow).toBe(false);
    });

    test("834px: two-column custom field layout renders without overflow", async ({ page }) => {
      await seedDefinition("CLIENT", "TEXT", "Field A", { position: 0 });
      await seedDefinition("CLIENT", "NUMBER", "Field B", { position: 1 });
      await page.setViewportSize({ width: 834, height: 1100 });
      await page.goto(`/clients/${fixtures.clientA.id}/edit`);
      await expect(page.getByLabel("Field A")).toBeVisible();
      await expect(page.getByLabel("Field B")).toBeVisible();
      const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(hasOverflow).toBe(false);
    });

    test("1280px: full form including custom fields visible with no overflow", async ({ page }) => {
      await seedDefinition("CLIENT", "SELECT", "Wide Select", { position: 0 });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/clients/${fixtures.clientA.id}/edit`);
      await expect(page.getByLabel("Wide Select")).toBeVisible();
      const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(hasOverflow).toBe(false);
    });
  });

  test("dark theme: Client edit form's custom fields are legible with no console errors", async ({ page, context, baseURL }) => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "DARK" } });
    await actAsOwner(context, baseURL!);
    await seedDefinition("CLIENT", "TEXT", "Dark Mode Field", { position: 0 });
    await seedDefinition("CLIENT", "CHECKBOX", "Dark Mode Checkbox", { position: 1 });

    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto(`/clients/${fixtures.clientA.id}/edit`);
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");
    await expect(page.getByLabel("Dark Mode Field")).toBeVisible();
    await expect(page.getByLabel("Dark Mode Checkbox")).toBeVisible();

    expect(errors).toEqual([]);

    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "SYSTEM" } });
  });
});
