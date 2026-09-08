import { randomUUID } from "node:crypto";
import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Multiple Contacts Phase 2 (Staff UI) — the new Contacts section on the
 * Client edit page. Covers the empty state, the full add/edit/set-
 * primary/archive/unarchive happy path through a real browser, and the
 * responsive/dark-theme gates. Domain-layer and Server Action correctness
 * (including every security/cross-org case) is already exhaustively
 * covered by test/integration/clients/contacts.test.ts and
 * contact-ui-actions.test.ts — deliberately not repeated here.
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

test.describe("Client Contacts UI (Multiple Contacts Phase 2)", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    // The lifecycle test's own ad-hoc Client (and its cascade-deleted
    // ClientContact rows) — swept BEFORE cleanupTestData(), same
    // established prefix-sweep convention as clients-migration.spec.ts's
    // own sibling files (test/integration/clients/delete.test.ts, etc.):
    // Client.userId is onDelete: Restrict, so an orphaned row here would
    // otherwise block cleanupTestData()'s own final User deletion.
    await dbQuery("client", "deleteMany", { where: { name: { startsWith: "E2E Contact Lifecycle" } } });
    await cleanupTestData(fixtures);
  });

  test.beforeEach(async ({ context, baseURL }) => {
    await actAsOwner(context, baseURL!);
  });

  test("1/2. empty state shows 'No contacts yet' with an Add contact button when the Client has none", async ({ page }) => {
    // fixtures.clientA is seeded with no email/phone, so no primary
    // contact was ever backfilled/auto-created for it.
    await page.goto(`/clients/${fixtures.clientA.id}/edit`);

    const contactsHeading = page.getByRole("heading", { name: "Contacts", level: 2 });
    await expect(contactsHeading).toBeVisible();
    await expect(page.getByText("No contacts yet")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add contact" })).toBeVisible();
  });

  test("full lifecycle: add, edit, set primary, archive, show archived, unarchive", async ({ page }) => {
    const client = await dbQuery<{ id: string }>("client", "create", {
      data: { name: `E2E Contact Lifecycle ${randomUUID().slice(0, 8)}`, organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
    });

    await page.goto(`/clients/${client.id}/edit`);

    // --- Add contact (as primary) ---
    await page.getByRole("button", { name: "Add contact" }).click();
    const addDialog = page.getByRole("dialog", { name: "Add contact" });
    await expect(addDialog).toBeVisible();
    await addDialog.getByLabel("Name").fill("Jane Smith");
    await addDialog.getByLabel("Email").fill("jane@example.com");
    await addDialog.getByLabel("Phone").fill("555-0100");
    await addDialog.getByLabel("Role").fill("Owner");
    await addDialog.getByLabel("Make this the primary contact").check();
    await addDialog.getByRole("button", { name: "Add contact" }).click();
    await expect(addDialog).not.toBeVisible();

    const janeRow = page.getByRole("row", { name: /Jane Smith/ });
    await expect(janeRow).toBeVisible();
    await expect(janeRow.getByText("Primary", { exact: true })).toBeVisible();
    await expect(janeRow.getByText("jane@example.com")).toBeVisible();

    // Client.email synced from the new primary (Phase 1 compatibility rule).
    const clientAfterAdd = await dbQuery<{ email: string | null }>("client", "findUnique", { where: { id: client.id } });
    expect(clientAfterAdd.email).toBe("jane@example.com");

    // --- Add a second contact (not primary) ---
    await page.getByRole("button", { name: "Add contact" }).click();
    const addDialog2 = page.getByRole("dialog", { name: "Add contact" });
    await addDialog2.getByLabel("Name").fill("Mark Lee");
    await addDialog2.getByLabel("Email").fill("mark@example.com");
    await addDialog2.getByRole("button", { name: "Add contact" }).click();
    await expect(addDialog2).not.toBeVisible();
    const markRow = page.getByRole("row", { name: /Mark Lee/ });
    await expect(markRow).toBeVisible();
    await expect(markRow.getByText("Primary", { exact: true })).not.toBeVisible();

    // --- Edit Jane (the primary) ---
    await janeRow.getByRole("button", { name: "Edit" }).click();
    const editDialog = page.getByRole("dialog", { name: "Edit contact" });
    await expect(editDialog).toBeVisible();
    await expect(editDialog.getByText("This is the primary contact.")).toBeVisible();
    await editDialog.getByLabel("Role").fill("CEO");
    await editDialog.getByRole("button", { name: "Save changes" }).click();
    await expect(editDialog).not.toBeVisible();

    // --- Set Mark as primary ---
    await markRow.getByRole("button", { name: "Set primary" }).click();
    await expect(page.getByRole("row", { name: /Mark Lee/ }).getByText("Primary", { exact: true })).toBeVisible();
    await expect(page.getByRole("row", { name: /Jane Smith/ }).getByText("Primary", { exact: true })).not.toBeVisible();

    const clientAfterSwitch = await dbQuery<{ email: string | null }>("client", "findUnique", { where: { id: client.id } });
    expect(clientAfterSwitch.email).toBe("mark@example.com");

    // --- Archive Jane (now a secondary contact) ---
    await page.getByRole("row", { name: /Jane Smith/ }).getByRole("button", { name: "Archive" }).click();
    const archiveDialog = page.getByRole("dialog", { name: "Archive contact" });
    await expect(archiveDialog).toBeVisible();
    await archiveDialog.getByRole("button", { name: "Archive" }).click();
    await expect(page.getByRole("row", { name: /Jane Smith/ })).not.toBeVisible();

    // --- Show archived, then unarchive ---
    await page.getByRole("button", { name: /Show archived/ }).click();
    const archivedJaneRow = page.getByRole("row", { name: /Jane Smith/ });
    await expect(archivedJaneRow).toBeVisible();
    await archivedJaneRow.getByRole("button", { name: "Unarchive" }).click();
    await expect(page.getByRole("button", { name: "Show active" })).toBeVisible();
    await page.getByRole("button", { name: "Show active" }).click();
    await expect(page.getByRole("row", { name: /Jane Smith/ })).toBeVisible();
    // Restored as non-primary — Mark remains the one active primary.
    await expect(page.getByRole("row", { name: /Jane Smith/ }).getByText("Primary", { exact: true })).not.toBeVisible();
  });

  test("Mobile (390px), empty state: the Contacts section fits the viewport with no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/clients/${fixtures.clientA.id}/edit`);
    await expect(page.getByRole("heading", { name: "Contacts", level: 2 })).toBeVisible();

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  });

  test.describe("Contacts UI Polish — responsive breakpoints (populated list)", () => {
    let client: { id: string };

    test.beforeAll(async () => {
      client = await dbQuery<{ id: string }>("client", "create", {
        data: { name: `E2E Contact Responsive ${randomUUID().slice(0, 8)}`, organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
      });
      // A non-primary active contact (worst case for the Actions column —
      // Edit + Set primary + Archive, three buttons) with every column
      // populated (email/phone/role) so hiding/wrapping is actually
      // exercised, not just an empty/near-empty row.
      await dbQuery("clientContact", "create", {
        data: {
          organizationId: fixtures.orgA.id,
          clientId: client.id,
          name: "Priya Nair",
          email: "priya@example.com",
          phone: "555-0177",
          role: "Finance Director",
          isBilling: true,
        },
      });
      // The primary contact (Edit + Archive only) — also exercises the
      // Primary badge staying legible at every width.
      await dbQuery("clientContact", "create", {
        data: {
          organizationId: fixtures.orgA.id,
          clientId: client.id,
          name: "Sam Ortiz",
          email: "sam@example.com",
          phone: "555-0188",
          role: "Owner",
          isPrimary: true,
        },
      });
      // An archived contact (Section G) — must show its Billing badge,
      // never a Primary badge even if isPrimary was left true internally,
      // and expose Unarchive clearly.
      await dbQuery("clientContact", "create", {
        data: {
          organizationId: fixtures.orgA.id,
          clientId: client.id,
          name: "Alex Chen",
          email: "alex@example.com",
          isBilling: true,
          isPrimary: true,
          archivedAt: new Date(),
        },
      });
    });

    test.afterAll(async () => {
      await dbQuery("client", "deleteMany", { where: { name: { startsWith: "E2E Contact Responsive" } } });
    });

    test("390px: name/email/actions visible and reachable, Role hidden, no page overflow", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 900 });
      await page.goto(`/clients/${client.id}/edit`);

      const priyaRow = page.getByRole("row", { name: /Priya Nair/ });
      await expect(priyaRow).toBeVisible();
      await expect(priyaRow.getByText("priya@example.com")).toBeVisible();
      await expect(priyaRow.getByRole("button", { name: "Edit" })).toBeVisible();
      await expect(priyaRow.getByRole("button", { name: "Set primary" })).toBeVisible();
      await expect(priyaRow.getByRole("button", { name: "Archive" })).toBeVisible();

      // Role is the lowest-priority column — hidden at this width so it
      // never crushes the layout or forces character-by-character wrap.
      await expect(page.getByRole("columnheader", { name: "Role" })).not.toBeVisible();
      await expect(page.getByText("Finance Director")).not.toBeVisible();

      // Active primary state stays legible.
      const samRow = page.getByRole("row", { name: /Sam Ortiz/ });
      await expect(samRow.getByText("Primary", { exact: true })).toBeVisible();

      // Archived contact: Billing badge shown, Primary badge never shown,
      // Unarchive clearly reachable.
      await page.getByRole("button", { name: /Show archived/ }).click();
      const alexRow = page.getByRole("row", { name: /Alex Chen/ });
      await expect(alexRow).toBeVisible();
      await expect(alexRow.getByText("Billing", { exact: true })).toBeVisible();
      await expect(alexRow.getByText("Primary", { exact: true })).not.toBeVisible();
      await expect(alexRow.getByRole("button", { name: "Unarchive" })).toBeVisible();

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    });

    test("834px (tablet): Role still hidden (no ugly wrapping), Phone visible, actions reachable, no overflow", async ({ page }) => {
      await page.setViewportSize({ width: 834, height: 1100 });
      await page.goto(`/clients/${client.id}/edit`);

      const priyaRow = page.getByRole("row", { name: /Priya Nair/ });
      await expect(priyaRow).toBeVisible();
      await expect(priyaRow.getByText("555-0177")).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Role" })).not.toBeVisible();

      await expect(priyaRow.getByRole("button", { name: "Edit" })).toBeVisible();
      await expect(priyaRow.getByRole("button", { name: "Set primary" })).toBeVisible();
      await expect(priyaRow.getByRole("button", { name: "Archive" })).toBeVisible();

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    });

    test("1280px (desktop): the full table — Email/Phone/Role/Actions — remains visible and readable", async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/clients/${client.id}/edit`);

      await expect(page.getByRole("columnheader", { name: "Email" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Phone" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Role" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Actions" })).toBeVisible();

      const priyaRow = page.getByRole("row", { name: /Priya Nair/ });
      await expect(priyaRow.getByText("Finance Director")).toBeVisible();
      await expect(priyaRow.getByRole("button", { name: "Edit" })).toBeVisible();
      await expect(priyaRow.getByRole("button", { name: "Set primary" })).toBeVisible();
      await expect(priyaRow.getByRole("button", { name: "Archive" })).toBeVisible();
    });

    test("Dark theme, tablet (834px): Contacts table is legible, no console errors", async ({ page, context, baseURL }) => {
      await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "DARK" } });
      await actAsOwner(context, baseURL!);

      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));

      await page.setViewportSize({ width: 834, height: 1100 });
      await page.goto(`/clients/${client.id}/edit`);
      await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");

      const priyaRow = page.getByRole("row", { name: /Priya Nair/ });
      await expect(priyaRow).toBeVisible();
      await expect(priyaRow.getByRole("button", { name: "Archive" })).toBeVisible();

      expect(errors).toEqual([]);
    });
  });

  test("Dark theme: Contacts section heading is legible, no console errors", async ({ page, context, baseURL }) => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "DARK" } });
    await actAsOwner(context, baseURL!);

    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto(`/clients/${fixtures.clientA.id}/edit`);
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");

    const heading = page.getByRole("heading", { name: "Contacts", level: 2 });
    await expect(heading).toBeVisible();
    // Same computed text color every other migrated Dark heading on this
    // page already asserts (clients-migration.spec.ts) — text-text-primary.
    await expect.poll(() => heading.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(236, 237, 238)");

    expect(errors).toEqual([]);
  });
});
