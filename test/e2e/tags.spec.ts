import { randomUUID } from "node:crypto";
import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Tags V2 (Staff UI) — Settings → Tags management, the embedded Client/
 * Lead "Tags" form section, list display, and single-tag filtering,
 * through a real browser. Domain-layer/Server Action correctness
 * (role gating, tenant isolation, archived-tag/idempotency rules) is
 * already exhaustively covered by test/integration/tags/*.test.ts —
 * deliberately not repeated here; this file is about the actual rendered
 * UI a Staff member interacts with, mirroring
 * custom-statuses-settings.spec.ts/custom-fields-entity-values.spec.ts's
 * own structure and technique.
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

async function actAsMember(context: BrowserContext, baseURL: string): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, fixtures.member, baseURL);
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

type SeededTag = { id: string; name: string };

async function seedTag(name: string, overrides: Record<string, unknown> = {}): Promise<SeededTag> {
  const created = await dbQuery<{ id: string; name: string }>("tag", "create", {
    data: { organizationId: fixtures.orgA.id, name, normalizedName: name.toLowerCase(), color: "INFO", ...overrides },
  });
  return { id: created.id, name: created.name };
}

async function assignTagRow(tagId: string, entityType: "CLIENT" | "LEAD", entityId: string): Promise<void> {
  await dbQuery("tagAssignment", "create", {
    data: { organizationId: fixtures.orgA.id, tagId, entityType, entityId },
  });
}

/** Same "row-first, then its own Edit link" navigation convention every other list page in this app already uses — see custom-fields-entity-values.spec.ts's own identical helper. Explicitly waits for the resulting URL (rather than just the click) so a slower client-side transition never races the next assertion. */
async function goToEdit(page: import("@playwright/test").Page, recordName: string): Promise<void> {
  await page.getByRole("row", { name: recordName }).getByRole("link", { name: "Edit" }).click();
  await page.waitForURL(/\/edit$/);
}

test.describe("Tags V2 — Staff UI", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
    // Custom Statuses Phase 2B (Section G) — seedE2EFixtures()'s own org
    // fixture is deliberately never bootstrapped with
    // CustomStatusDefinition rows; the Client create/edit form requires
    // one. This file is about Tags, unrelated to status — see
    // custom-fields-entity-values.spec.ts's own identical comment.
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
  });

  test.afterAll(async () => {
    await dbQuery("tagAssignment", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
    await dbQuery("tag", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
    // CustomStatusDefinition is deliberately NOT deleted here directly —
    // a real edit-form save in this file (see the "Client edit" test
    // below) sets fixtures.clientA's own statusDefinitionId to the
    // definition seeded above, and Client -> CustomStatusDefinition is a
    // Restrict FK (see that model's own schema doc comment), so a direct
    // deleteMany here would fail while that reference still exists.
    // cleanupTestData() below deletes fixtures.clientA itself first, then
    // the whole Organization (which cascades to CustomStatusDefinition) —
    // the correct order for real Production-shaped delete behavior.
    await cleanupTestData(fixtures);
  });

  test.afterEach(async () => {
    await dbQuery("tagAssignment", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
    await dbQuery("tag", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
    await dbQuery("client", "deleteMany", { where: { organizationId: fixtures.orgA.id, id: { not: fixtures.clientA.id } } });
    await dbQuery("lead", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
  });

  test.describe("Settings → Tags", () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await actAsOwner(context, baseURL!);
    });

    test("OWNER: empty state, create a tag, edit its name/color, archive it", async ({ page }) => {
      await page.goto("/settings/tags");
      await expect(page.getByRole("heading", { name: "Tags" })).toBeVisible();
      await expect(page.getByText("No tags yet")).toBeVisible();

      await page.getByRole("button", { name: "Add tag" }).click();
      const createDialog = page.locator("dialog[open]");
      await createDialog.getByLabel("Name").fill("VIP");
      await createDialog.getByLabel("Color").selectOption("SUCCESS");
      await createDialog.getByRole("button", { name: "Add tag" }).click();
      await expect(createDialog).toHaveCount(0);

      const row = page.getByRole("row", { name: /VIP/ });
      await expect(row).toBeVisible();

      await row.getByRole("button", { name: "Edit" }).click();
      const editDialog = page.locator("dialog[open]");
      await editDialog.getByLabel("Name").fill("Very Important");
      await editDialog.getByLabel("Color").selectOption("DANGER");
      await editDialog.getByRole("button", { name: "Save changes" }).click();
      await expect(editDialog).toHaveCount(0);
      await expect(page.getByRole("row", { name: /Very Important/ })).toBeVisible();

      const renamedRow = page.getByRole("row", { name: /Very Important/ });
      await renamedRow.getByRole("button", { name: "Archive" }).click();
      const confirmDialog = page.locator("dialog[open]");
      await expect(confirmDialog.getByText("Archive tag")).toBeVisible();
      await confirmDialog.getByRole("button", { name: "Archive", exact: true }).click();
      await expect(page.getByText("No tags yet")).toBeVisible();

      await page.getByRole("button", { name: /Show archived/ }).click();
      await expect(page.getByRole("row", { name: /Very Important/ })).toBeVisible();
    });

    test("a duplicate normalized name is rejected with a field-level error, not silently ignored", async ({ page }) => {
      await seedTag("Urgent");
      await page.goto("/settings/tags");

      await page.getByRole("button", { name: "Add tag" }).click();
      const dialog = page.locator("dialog[open]");
      await dialog.getByLabel("Name").fill("URGENT");
      await dialog.getByRole("button", { name: "Add tag" }).click();

      await expect(dialog.getByText("A tag with this name already exists.")).toBeVisible();
    });
  });

  test.describe("MEMBER is blocked from Settings → Tags", () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await actAsMember(context, baseURL!);
    });

    test("the Tags nav entry is hidden, and the page itself renders 'Not available' for a direct visit", async ({ page }) => {
      await page.goto("/settings/company");
      await expect(page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Tags" })).toHaveCount(0);

      await page.goto("/settings/tags");
      await expect(page.getByText("Not available")).toBeVisible();
      await expect(page.getByRole("button", { name: "Add tag" })).toHaveCount(0);
    });
  });

  test.describe("Client/Lead assignment + list display + filtering", () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await actAsOwner(context, baseURL!);
    });

    test("Client edit: the Tags section lists active tags as checkboxes, an archived assignment stays visible but not selectable, and saving persists the change", async ({ page }) => {
      const active = await seedTag("Priority Client");
      const toArchive = await seedTag("Legacy Tag");
      await assignTagRow(toArchive.id, "CLIENT", fixtures.clientA.id);
      await dbQuery("tag", "update", { where: { id: toArchive.id }, data: { archivedAt: new Date().toISOString() } });

      await page.goto("/clients");
      await goToEdit(page, fixtures.clientA.name);
      await expect(page.getByText("Tags", { exact: true })).toBeVisible();
      await expect(page.getByText("Legacy Tag (archived)")).toBeVisible();
      // The archived tag never renders as a checkbox at all.
      await expect(page.getByRole("checkbox", { name: /Legacy Tag/ })).toHaveCount(0);

      // The checkbox itself carries no visible text of its own (its
      // sibling TagChip does) — located via the enclosing <label>.
      await page.locator("label", { hasText: active.name }).locator('input[type="checkbox"]').check();

      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page).toHaveURL("/clients");

      const assignments = await dbQuery<{ tagId: string }[]>("tagAssignment", "findMany", {
        where: { entityType: "CLIENT", entityId: fixtures.clientA.id, tagId: active.id },
      });
      expect(assignments).toHaveLength(1);
    });

    test("Clients list: the Tags column shows an assigned tag, and the Tag filter narrows the list to only matching clients", async ({ page }) => {
      const tag = await seedTag("Filterable");
      await assignTagRow(tag.id, "CLIENT", fixtures.clientA.id);
      const other = await dbQuery<{ id: string; name: string }>("client", "create", {
        data: { name: `No Tag Client ${randomUUID().slice(0, 6)}`, organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
      });

      await page.goto("/clients");
      await expect(page.getByRole("row", { name: fixtures.clientA.name })).toContainText("Filterable");

      await page.getByLabel("Tag").selectOption({ label: "Filterable" });
      await expect(page).toHaveURL(/tag=/);
      await expect(page.getByRole("row", { name: fixtures.clientA.name })).toBeVisible();
      await expect(page.getByRole("row", { name: other.name })).toHaveCount(0);
    });

    test("Lead create: the Tags section is present and a selected tag persists", async ({ page }) => {
      const tag = await seedTag("Hot Lead");

      await page.goto("/leads/new");
      await expect(page.getByText("Tags", { exact: true })).toBeVisible();
      await page.getByRole("textbox", { name: "Name", exact: true }).fill("Tagged Lead E2E");
      await page.locator("label", { hasText: tag.name }).locator('input[type="checkbox"]').check();
      await page.getByRole("button", { name: "Create lead" }).click();
      await expect(page).toHaveURL("/leads");

      const lead = await dbQuery<{ id: string }>("lead", "findFirstOrThrow", {
        where: { organizationId: fixtures.orgA.id, name: "Tagged Lead E2E" },
      });
      const assignments = await dbQuery<{ tagId: string }[]>("tagAssignment", "findMany", {
        where: { entityType: "LEAD", entityId: lead.id },
      });
      expect(assignments.map((a) => a.tagId)).toEqual([tag.id]);
    });
  });

  test.describe("responsive", () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await actAsOwner(context, baseURL!);
    });

    async function seedThreeTags(): Promise<void> {
      for (const name of ["Alpha Tag", "Beta Tag", "Gamma Tag"]) {
        await seedTag(name);
      }
    }

    test("Settings → Tags at 390px: populated list has no page-level horizontal overflow, Add button reachable, dialog fits the viewport", async ({ page }) => {
      await seedThreeTags();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/settings/tags");

      await expect(page.getByRole("row", { name: /Beta Tag/ })).toBeVisible();
      const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(hasOverflow).toBe(false);

      await page.getByRole("button", { name: "Add tag" }).click();
      const dialog = page.locator("dialog[open]");
      await expect(dialog).toBeVisible();
      const box = await dialog.boundingBox();
      expect(box?.width).toBeLessThanOrEqual(390);
    });

    test("Settings → Tags at 834px: populated list and row actions remain usable, no overflow", async ({ page }) => {
      await seedThreeTags();
      await page.setViewportSize({ width: 834, height: 1100 });
      await page.goto("/settings/tags");

      await expect(page.getByRole("row", { name: /Gamma Tag/ })).toBeVisible();
      await expect(page.getByRole("row", { name: /Alpha Tag/ }).getByRole("button", { name: "Edit" })).toBeVisible();
      const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(hasOverflow).toBe(false);
    });

    test("Client edit form at 390px: the Tags section wraps its chips without any page-level horizontal overflow", async ({ page }) => {
      await seedThreeTags();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/clients");
      // At this width the desktop <table> (and its own "Edit" link) is
      // CSS-hidden, not DOM-absent — goToEdit's own row-based locator
      // would time out waiting for it to become actionable. The mobile
      // RecordCardList's own "Edit" link is the one actually visible
      // here.
      await page.getByRole("listitem").filter({ hasText: fixtures.clientA.name }).getByRole("link", { name: "Edit" }).click();
      await page.waitForURL(/\/edit$/);

      await expect(page.getByText("Tags", { exact: true })).toBeVisible();
      const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(hasOverflow).toBe(false);
      await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();
    });

    test("Clients list at 390px: the Tag filter is reachable and row actions remain usable, no destructive overflow beyond this app's own existing pattern", async ({ page }) => {
      const tag = await seedTag("Mobile Filter Tag");
      await assignTagRow(tag.id, "CLIENT", fixtures.clientA.id);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/clients");

      await expect(page.getByLabel("Tag")).toBeVisible();
      // Every existing list page's own mobile layout is card-based, not a
      // scrollable table (RecordCardList) — this app's own established
      // pattern (see clients/page.tsx's own `hidden xl:block` desktop
      // table). This asserts that pattern still holds with Tags added,
      // not a new layout.
      const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(hasOverflow).toBe(false);
      // At this width, only the mobile RecordCardList (each record its
      // own <li>) renders visibly — scoping to "listitem" is unambiguous
      // (the hidden desktop <table> and any inert <dialog> markup are
      // neither).
      await expect(page.getByRole("listitem").filter({ hasText: fixtures.clientA.name })).toBeVisible();
    });
  });
});
