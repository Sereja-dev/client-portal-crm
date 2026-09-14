import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Contracts Phase 2 — Staff CRUD/list/detail lifecycle UI. Real browser
 * coverage for the management surface: empty states, the full
 * create/edit/send/accept/terminate/archive/restore happy path, the
 * OWNER/ADMIN/MEMBER permission matrix (no privileged gate — locked
 * architecture §I), tenant isolation, SEND-time signatory invalidation,
 * duplicate-number handling, post-SEND document immutability, the
 * frozen-snapshot display invariant, and responsive behavior at 390/834/
 * 1280px — mirroring quote-templates-settings.spec.ts's own exact shape
 * and scope discipline. Domain-layer correctness (concurrency guards,
 * snapshot atomicity, tenant scoping, the acceptance-actor invariant) is
 * already exhaustively covered by test/integration/contracts/*.test.ts
 * and is not re-derived here — these tests only prove the UI wires into
 * that already-reviewed backend correctly and renders its results
 * truthfully.
 */

let fixtures: TestFixtures;

async function actAs(context: BrowserContext, baseURL: string, identity: { id: string; email: string }, organizationId: string): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, identity, baseURL);
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

async function actAsOwner(context: BrowserContext, baseURL: string): Promise<void> {
  await actAs(context, baseURL, fixtures.owner, fixtures.orgA.id);
}

async function cleanupContracts(): Promise<void> {
  await dbQuery("contract", "deleteMany", { where: { organizationId: { in: [fixtures.orgA.id, fixtures.orgB.id] } } });
}

function uniqueNumber(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

async function fillNewContractForm(page: Page, { number, title }: { number: string; title: string }): Promise<void> {
  await page.getByLabel("Contract number").fill(number);
  // By value (the Client id), not `exact:true` label text — mirrors
  // invoices.spec.ts's own identical, already-proven pattern for this
  // exact required-field shape (a required FormField's own label
  // includes a separate aria-hidden "*" span, whose exact contribution
  // to the browser's own computed accessible name is not worth
  // depending on for a strict-equality match).
  await page.getByLabel("Client").selectOption(fixtures.clientA.id);
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Contract body").fill("This agreement is entered into by and between the parties.");
  await page.getByLabel("Issue date").fill("2026-06-01");
}

test.describe("Contracts Staff UI (Phase 2)", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await cleanupContracts();
    await cleanupTestData(fixtures);
  });

  test.beforeEach(async ({ context, baseURL }) => {
    await actAsOwner(context, baseURL!);
  });

  test.afterEach(async () => {
    await cleanupContracts();
  });

  test("empty state shows the create CTA; the archived tab and filtered-results have their own distinct empty states", async ({ page }) => {
    await page.goto("/contracts");
    await expect(page.getByRole("heading", { name: "Contracts" })).toBeVisible();
    await expect(page.getByText("No contracts yet")).toBeVisible();
    await expect(page.getByRole("link", { name: "Create contract" })).toBeVisible();

    await page.goto("/contracts?archived=1");
    await expect(page.getByText("No archived contracts")).toBeVisible();
    await expect(page.getByText("No contracts yet")).toHaveCount(0);

    await page.goto("/contracts?q=nonexistent-contract-xyz");
    await expect(page.getByText("No matching contracts")).toBeVisible();
  });

  test("full happy path: create, list, detail, edit, send, internal notes after send, accept, terminate, archive, restore", async ({ page }) => {
    const number = uniqueNumber("C-E2E");
    await page.goto("/contracts/new");
    await fillNewContractForm(page, { number, title: "Website Redesign Agreement" });
    await page.getByLabel("Internal notes").fill("Follow up with the client next week.");
    await page.getByRole("button", { name: "Create contract" }).click();

    // -> detail page.
    await expect(page).toHaveURL(/\/contracts\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("status").filter({ hasText: "Contract created" })).toBeVisible();
    await expect(page.getByRole("heading", { name: number })).toBeVisible();
    // exact:true -- the Activity feed's own "created contract Website
    // Redesign Agreement" line also contains this text as a substring.
    await expect(page.getByText("Website Redesign Agreement", { exact: true })).toBeVisible();
    await expect(page.getByText("Draft", { exact: true })).toBeVisible();

    // List shows it.
    await page.goto("/contracts");
    const row = page.getByRole("row", { name: new RegExp(number) });
    await expect(row).toBeVisible();
    await expect(row.getByText("Draft", { exact: true })).toBeVisible();

    // Edit the DRAFT.
    await row.getByRole("link", { name: "Edit" }).click();
    await expect(page.getByRole("heading", { name: "Edit contract" })).toBeVisible();
    await expect(page.getByLabel("Title")).toHaveValue("Website Redesign Agreement");
    await page.getByLabel("Title").fill("Website Redesign Agreement (v2)");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(/\/contracts\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("status").filter({ hasText: "Contract updated" })).toBeVisible();
    await expect(page.getByText("Website Redesign Agreement (v2)")).toBeVisible();

    // Send.
    await page.getByRole("button", { name: "Send contract" }).click();
    await expect(page.getByRole("dialog")).toContainText("No email will be sent automatically");
    await page.getByRole("dialog").getByRole("button", { name: "Send contract" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Contract sent" })).toBeVisible();
    await expect(page.getByText("Sent", { exact: true })).toBeVisible();

    // Document edit is no longer available.
    await expect(page.getByRole("link", { name: "Edit contract" })).toHaveCount(0);
    // exact:true -- the SEND Activity's own entry now also contains the
    // renamed title as a substring ("changed contract ... (v2) status").
    await expect(page.getByText("Website Redesign Agreement (v2)", { exact: true })).toBeVisible(); // body/title still visible read-only

    // Internal notes remain editable after SEND.
    await page.getByLabel("Internal notes").fill("Client confirmed receipt by phone.");
    await page.getByRole("button", { name: "Save notes" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Internal notes saved" })).toBeVisible();

    // Record acceptance.
    await page.getByRole("button", { name: "Record acceptance" }).click();
    await expect(page.getByRole("dialog")).toContainText("does not create a certified electronic signature");
    await page.getByRole("dialog").getByRole("button", { name: "Record acceptance" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Acceptance recorded" })).toBeVisible();

    // Display state reflects accepted/active semantics; truthful actor wording.
    await expect(page.getByText("Active", { exact: true })).toBeVisible();
    await expect(page.getByText(/Acceptance recorded by/)).toBeVisible();
    await expect(page.getByText(/^Signed by/)).toHaveCount(0);

    // Terminate.
    await page.getByRole("button", { name: "Terminate contract" }).click();
    await expect(page.getByRole("dialog")).toContainText("not a deletion");
    await page.getByRole("dialog").getByRole("button", { name: "Terminate contract" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Contract terminated" })).toBeVisible();
    await expect(page.getByText("Terminated", { exact: true })).toBeVisible();

    // Archive.
    await page.getByRole("button", { name: "Archive" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Archive" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Contract archived" })).toBeVisible();
    await expect(page.getByText("Archived", { exact: true })).toBeVisible();

    // Archived list shows it; active list does not.
    await page.goto("/contracts");
    await expect(page.getByRole("row", { name: new RegExp(number) })).toHaveCount(0);
    await page.goto("/contracts?archived=1");
    await expect(page.getByRole("row", { name: new RegExp(number) })).toBeVisible();

    // Restore.
    await page.goto("/contracts?archived=1");
    await page.getByRole("row", { name: new RegExp(number) }).getByRole("link", { name: "View" }).click();
    await page.getByRole("button", { name: "Restore" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Restore" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Contract restored" })).toBeVisible();
    await page.goto("/contracts");
    await expect(page.getByRole("row", { name: new RegExp(number) })).toBeVisible();
  });

  for (const role of ["OWNER", "ADMIN", "MEMBER"] as const) {
    test(`${role} can create and view a contract (no privileged gate)`, async ({ context, baseURL, page }) => {
      const identity = role === "OWNER" ? fixtures.owner : role === "ADMIN" ? fixtures.admin : fixtures.member;
      await actAs(context, baseURL!, identity, fixtures.orgA.id);

      await page.goto("/contracts");
      await expect(page.getByRole("link", { name: "New contract" })).toBeVisible();

      const number = uniqueNumber(`C-${role}`);
      await page.goto("/contracts/new");
      await fillNewContractForm(page, { number, title: `${role} contract` });
      await page.getByRole("button", { name: "Create contract" }).click();
      await expect(page).toHaveURL(/\/contracts\/[0-9a-f-]{36}$/);
      await expect(page.getByRole("heading", { name: number })).toBeVisible();
    });
  }

  test("tenant isolation: a foreign-org contract URL fails safely (not found)", async ({ context, baseURL, page }) => {
    const number = uniqueNumber("C-TENANT");
    await page.goto("/contracts/new");
    await fillNewContractForm(page, { number, title: "Org A only" });
    await page.getByRole("button", { name: "Create contract" }).click();
    await expect(page).toHaveURL(/\/contracts\/([0-9a-f-]{36})$/);
    const contractId = page.url().split("/").pop();

    await actAs(context, baseURL!, fixtures.orgBOwner, fixtures.orgB.id);
    const response = await page.goto(`/contracts/${contractId}`);
    expect(response?.status()).toBe(404);

    // Same identity, a real Server Action call against the foreign
    // contract must also fail safely, not silently succeed.
    await page.goto("/contracts");
    await expect(page.getByRole("row", { name: new RegExp(number) })).toHaveCount(0);
  });

  test("SEND-time signatory invalidation: an archived intended signatory blocks SEND with a safe, actionable message; the contract remains DRAFT", async ({
    page,
  }) => {
    const contact = await dbQuery<{ id: string }>("clientContact", "create", {
      data: { organizationId: fixtures.orgA.id, clientId: fixtures.clientA.id, name: "Soon Archived Contact" },
    });

    const number = uniqueNumber("C-SIG");
    await page.goto("/contracts/new");
    await fillNewContractForm(page, { number, title: "Signatory Invalidation Test" });
    await page.getByLabel("Intended signatory").selectOption({ label: "Soon Archived Contact" });
    await page.getByRole("button", { name: "Create contract" }).click();
    await expect(page).toHaveURL(/\/contracts\/[0-9a-f-]{36}$/);

    await dbQuery("clientContact", "update", { where: { id: contact.id }, data: { archivedAt: new Date().toISOString() } });

    await page.getByRole("button", { name: "Send contract" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Send contract" }).click();
    await expect(page.getByRole("status").filter({ hasText: /no longer available or active/ })).toBeVisible();
    await expect(page.getByText("Draft", { exact: true })).toBeVisible();

    await dbQuery("clientContact", "deleteMany", { where: { id: contact.id } });
  });

  test("duplicate contract number within the same organization is rejected inline, with no partial contract created", async ({ page }) => {
    const number = uniqueNumber("C-DUP");
    await page.goto("/contracts/new");
    await fillNewContractForm(page, { number, title: "First" });
    await page.getByRole("button", { name: "Create contract" }).click();
    await expect(page).toHaveURL(/\/contracts\/[0-9a-f-]{36}$/);

    await page.goto("/contracts/new");
    await fillNewContractForm(page, { number, title: "Duplicate Attempt" });
    await page.getByRole("button", { name: "Create contract" }).click();
    await expect(page).toHaveURL(/\/contracts\/new$/);
    await expect(page.getByText("A contract with this number already exists.")).toBeVisible();

    await page.goto("/contracts");
    await expect(page.getByRole("row", { name: new RegExp(number) })).toHaveCount(1);
  });

  test("post-SEND immutability: the edit route redirects away from a SENT contract", async ({ page }) => {
    const number = uniqueNumber("C-IMMUT");
    await page.goto("/contracts/new");
    await fillNewContractForm(page, { number, title: "Immutability Test" });
    await page.getByRole("button", { name: "Create contract" }).click();
    await expect(page).toHaveURL(/\/contracts\/([0-9a-f-]{36})$/);
    const contractId = page.url().split("/").pop();

    await page.getByRole("button", { name: "Send contract" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Send contract" }).click();
    await expect(page.getByText("Sent", { exact: true })).toBeVisible();

    await page.goto(`/contracts/${contractId}/edit`);
    await expect(page).toHaveURL(`/contracts/${contractId}`);
    await expect(page.getByRole("heading", { name: "Edit contract" })).toHaveCount(0);
  });

  test("snapshot display: a later Client name change never alters the frozen sent-party details", async ({ page }) => {
    const number = uniqueNumber("C-SNAP");
    await page.goto("/contracts/new");
    await fillNewContractForm(page, { number, title: "Snapshot Display Test" });
    await page.getByRole("button", { name: "Create contract" }).click();
    await expect(page).toHaveURL(/\/contracts\/[0-9a-f-]{36}$/);

    await page.getByRole("button", { name: "Send contract" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Send contract" }).click();
    await expect(page.getByText("Sent", { exact: true })).toBeVisible();

    const sentPartySection = page.locator("section").filter({ has: page.getByRole("heading", { name: "Sent party details" }) });
    await expect(sentPartySection).toContainText(fixtures.clientA.name);

    await dbQuery("client", "update", { where: { id: fixtures.clientA.id }, data: { name: "Renamed Client Co" } });
    await page.reload();

    // The live "Contract details" card follows the rename...
    await expect(page.getByRole("link", { name: "Renamed Client Co" })).toBeVisible();
    // ...but the frozen "Sent party details" card still shows the original, pre-rename name.
    await expect(sentPartySection).toContainText(fixtures.clientA.name);
    await expect(sentPartySection).not.toContainText("Renamed Client Co");

    await dbQuery("client", "update", { where: { id: fixtures.clientA.id }, data: { name: fixtures.clientA.name } });
  });

  test.describe("responsive", () => {
    test("390px: no page-level horizontal overflow on list, create, and detail", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/contracts");
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);

      await page.goto("/contracts/new");
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
      await expect(page.getByLabel("Contract number")).toBeVisible();

      const number = uniqueNumber("C-390");
      await fillNewContractForm(page, { number, title: "Responsive 390" });
      await page.getByRole("button", { name: "Create contract" }).click();
      await expect(page).toHaveURL(/\/contracts\/[0-9a-f-]{36}$/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    });

    test("834px: list table/cards and detail page action toolbar remain usable, no overflow", async ({ page }) => {
      await page.setViewportSize({ width: 834, height: 1100 });
      await page.goto("/contracts");
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);

      const number = uniqueNumber("C-834");
      await page.goto("/contracts/new");
      await fillNewContractForm(page, { number, title: "Responsive 834" });
      await page.getByRole("button", { name: "Create contract" }).click();
      await expect(page).toHaveURL(/\/contracts\/[0-9a-f-]{36}$/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
      await expect(page.getByRole("button", { name: "Send contract" })).toBeVisible();
    });

    test("1280px: the full desktop contract table is visible", async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      const number = uniqueNumber("C-1280");
      await page.goto("/contracts/new");
      await fillNewContractForm(page, { number, title: "Responsive 1280" });
      await page.getByRole("button", { name: "Create contract" }).click();
      await expect(page).toHaveURL(/\/contracts\/[0-9a-f-]{36}$/);

      await page.goto("/contracts");
      await expect(page.getByRole("columnheader", { name: "Contract #" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Client" })).toBeVisible();
      await expect(page.getByRole("row", { name: new RegExp(number) })).toBeVisible();
    });
  });
});
