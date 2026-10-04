import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Contract Templates V1 — the /contracts/new?templateId=<id> apply/
 * prefill flow. Real browser coverage for: the "Use template" picker
 * (active-only, hidden when empty), prefill correctness (title/body/
 * expiry/internalNotes), the safe fallback for an archived/foreign/
 * malformed template id (blank form + one generic notice, never a broken
 * page, never a leak of *why*), MEMBER's apply-without-manage permission
 * split, and the explicit independence of Client/Project/signatory/
 * contractNumber/issueDate from whichever template (if any) was applied
 * — the core Product guarantee this slice locks in (fixed decisions §2/
 * §6/§7). Mirrors invoice-apply-flow.spec.ts's own identical shape and
 * scope discipline. Domain-layer correctness (authorization, tenant
 * isolation, zero-write/snapshot guarantees) is already exhaustively
 * covered by test/integration/contract-templates/*.test.ts — these tests
 * only prove the UI wires into that already-verified backend correctly.
 */

let fixtures: TestFixtures;
let templateId: string;
let extraContractIds: string[] = [];

async function actAs(context: BrowserContext, baseURL: string, user: { id: string; email: string }): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, user, baseURL);
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

test.describe("Contract apply flow (V1)", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterEach(async () => {
    if (extraContractIds.length > 0) {
      await dbQuery("contract", "deleteMany", { where: { id: { in: extraContractIds } } });
      extraContractIds = [];
    }
  });

  test.afterAll(async () => {
    await dbQuery("contractTemplate", "deleteMany", { where: { organizationId: { in: [fixtures.orgA.id, fixtures.orgB.id] } } });
    await cleanupTestData(fixtures);
  });

  test("the picker is hidden when the organization has zero active templates (regression: blank flow is unchanged)", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.owner);
    await page.goto("/contracts/new");
    await expect(page.getByLabel("Start from a template")).toHaveCount(0);
    // Blank flow — today's issue date and a suggested contract number
    // are both prefilled exactly as before this feature.
    await expect(page.getByLabel("Issue date")).not.toHaveValue("");
    await expect(page.getByLabel("Contract number")).not.toHaveValue("");
    await expect(page.getByLabel("Title")).toHaveValue("");
  });

  test("selecting a template prefills title, body, expiry, and internal notes", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.owner);
    const created = await dbQuery<{ id: string }>("contractTemplate", "create", {
      data: {
        name: `Apply Template ${fixtures.runId}`,
        title: "Web Design Services Agreement",
        body: "These are the agreed terms of service.",
        defaultExpiryOffsetDays: 30,
        internalNotes: "Staff-only notes",
        organizationId: fixtures.orgA.id,
        createdByUserId: fixtures.owner.id,
      },
    });
    templateId = created.id;

    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto("/contracts/new");
    const picker = page.getByLabel("Start from a template");
    await expect(picker).toBeVisible();
    await picker.selectOption({ label: `Apply Template ${fixtures.runId}` });
    await expect(page).toHaveURL(new RegExp(`templateId=${templateId}`));

    await expect(page.getByLabel("Title")).toHaveValue("Web Design Services Agreement");
    await expect(page.getByLabel("Contract body")).toHaveValue("These are the agreed terms of service.");
    await expect(page.getByLabel("Internal notes")).toHaveValue("Staff-only notes");

    // issueDate + defaultExpiryOffsetDays (30) — a concrete, deterministic
    // value proving the "expiry relative to issueDate" invariant end to
    // end through the UI, not just in the underlying unit test.
    const issueDate = await page.getByLabel("Issue date").inputValue();
    const expected = new Date(`${issueDate}T00:00:00.000Z`);
    expected.setUTCDate(expected.getUTCDate() + 30);
    await expect(page.getByLabel("Expiry date")).toHaveValue(expected.toISOString().slice(0, 10));

    expect(errors).toEqual([]);
  });

  test("Client/Project/signatory/contractNumber/issueDate stay completely independent of the applied template", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.owner);
    await page.goto(`/contracts/new?templateId=${templateId}`);

    // Still an ordinary, unmodified target flow — Client/contractNumber/
    // issueDate selection is untouched by applying a template, and
    // completing the Contract works exactly as it would blank.
    const contractNumber = await page.getByLabel("Contract number").inputValue();
    expect(contractNumber).not.toBe("");
    await page.getByLabel("Client").selectOption(fixtures.clientA.id);
    await expect(page.getByLabel("Project")).toHaveValue("");
    await expect(page.getByLabel("Intended signatory")).toHaveValue("");

    await page.getByRole("button", { name: "Create contract" }).click();
    await expect(page).toHaveURL(/\/contracts\/[0-9a-f-]{36}$/);
    // Captured immediately once the id is known — before any further
    // assertion — so this Contract is always cleaned up even if a later
    // assertion in this test fails (it has a RESTRICT foreign key onto
    // Client, which would otherwise block this file's own fixture
    // teardown).
    const createdId = page.url().split("/").pop();
    if (createdId) extraContractIds.push(createdId);

    await expect(page.getByRole("status").filter({ hasText: "Contract created" })).toBeVisible();
    await expect(page.getByText("Web Design Services Agreement", { exact: true })).toBeVisible();
  });

  test("an archived template shows a generic unavailable notice and a blank form — never a broken page", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.owner);
    const archived = await dbQuery<{ id: string }>("contractTemplate", "create", {
      data: {
        name: `Archived Template ${fixtures.runId}`,
        title: "Archived Title",
        body: "Archived body",
        archivedAt: new Date().toISOString(),
        organizationId: fixtures.orgA.id,
        createdByUserId: fixtures.owner.id,
      },
    });

    await page.goto(`/contracts/new?templateId=${archived.id}`);
    await expect(page.getByText("This contract template is unavailable. Starting with a blank contract instead.")).toBeVisible();
    await expect(page.getByLabel("Title")).toHaveValue("");
  });

  test("a foreign-org template id behaves identically to a nonexistent one — no tenant leakage, same generic notice", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner);
    const foreign = await dbQuery<{ id: string }>("contractTemplate", "create", {
      data: {
        name: `Org B Secret Template ${fixtures.runId}`,
        title: "Org B Secret Title",
        body: "Org B secret body",
        organizationId: fixtures.orgB.id,
        createdByUserId: fixtures.orgBOwner.id,
      },
    });

    await page.goto(`/contracts/new?templateId=${foreign.id}`);
    await expect(page.getByText("This contract template is unavailable. Starting with a blank contract instead.")).toBeVisible();
    await expect(page.getByText("Org B Secret Title", { exact: false })).toHaveCount(0);

    // A malformed id renders the exact same way — never a driver-level
    // error, never a different message that would distinguish it from
    // the foreign-org case above.
    await page.goto(`/contracts/new?templateId=not-a-real-uuid`);
    await expect(page.getByText("This contract template is unavailable. Starting with a blank contract instead.")).toBeVisible();
  });

  test("MEMBER cannot manage templates but can still see and apply an active one from /contracts/new", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.member);
    await page.goto("/settings/contract-templates");
    await expect(page.getByText("Not available")).toBeVisible();

    await page.goto("/contracts/new");
    const picker = page.getByLabel("Start from a template");
    await expect(picker).toBeVisible();
    await picker.selectOption({ label: `Apply Template ${fixtures.runId}` });
    await expect(page).toHaveURL(new RegExp(`templateId=${templateId}`));
    await expect(page.getByLabel("Internal notes")).toHaveValue("Staff-only notes");
  });

  test("390x900: the templated new-contract form fits the viewport, no page-level horizontal overflow", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.owner);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/contracts/new?templateId=${templateId}`);

    await expect(page.getByRole("heading", { name: "New contract", level: 1 })).toBeVisible();
    await expect(page.getByLabel("Title")).toHaveValue("Web Design Services Agreement");

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);

    await expect(page.getByRole("button", { name: "Create contract" })).toBeVisible();
  });
});
