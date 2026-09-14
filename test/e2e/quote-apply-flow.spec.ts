import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Quote Templates Phase 2 — the /quotes/new?template=<id> apply/prefill
 * flow. Real browser coverage for: the "Use template" picker (active-
 * only, hidden when empty, preserves the rest of the URL), prefill
 * correctness (including exact decimal round-tripping), the safe
 * fallback for an archived/foreign/malformed template id (Section H:
 * blank form + one generic notice, never a broken page, never a leak of
 * *why*), MEMBER's apply-without-manage permission split, and the
 * unmodified blank-Quote regression. Domain-layer correctness
 * (authorization, tenant isolation, zero-write/snapshot guarantees) is
 * already exhaustively covered by test/integration/quote-templates/*.test.ts
 * — these tests only prove the UI wires into that already-verified
 * backend correctly.
 */

let fixtures: TestFixtures;
let templateId: string;

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

test.describe("Quote apply flow (Phase 2)", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await dbQuery("quoteTemplate", "deleteMany", { where: { organizationId: { in: [fixtures.orgA.id, fixtures.orgB.id] } } });
    await cleanupTestData(fixtures);
  });

  test("the picker is hidden when the organization has zero active templates (regression: blank flow is unchanged)", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.owner);
    await page.goto("/quotes/new");
    await expect(page.getByLabel("Start from a template")).toHaveCount(0);
    // Blank flow — an auto-suggested number and today's issue date, no
    // discount/tax, exactly as before this feature.
    await expect(page.getByLabel("Quote number")).not.toHaveValue("");
    await expect(page.getByLabel("Issue date")).not.toHaveValue("");
    await expect(page.getByLabel("Discount type")).toHaveValue("NONE");
  });

  test("selecting a template from the picker prefills the form with exact decimal values, preserving the target selectors", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner);
    const created = await dbQuery<{ id: string }>("quoteTemplate", "create", {
      data: {
        name: `Apply Template ${fixtures.runId}`,
        title: "Proposal title",
        notes: "Client-facing notes",
        currency: "EUR",
        discountType: "FIXED",
        discountValue: "10.01",
        taxRatePercent: "7.5",
        taxLabel: "VAT",
        validityDays: 30,
        organizationId: fixtures.orgA.id,
        createdByUserId: fixtures.owner.id,
        items: { create: [{ description: "Precise item", quantity: "1.125", unitPrice: "33.33", position: 0 }] },
      },
    });
    templateId = created.id;

    await page.goto("/quotes/new");
    const picker = page.getByLabel("Start from a template");
    await expect(picker).toBeVisible();
    await picker.selectOption({ label: `Apply Template ${fixtures.runId}` });
    await expect(page).toHaveURL(new RegExp(`template=${templateId}`));

    await expect(page.getByLabel("Title")).toHaveValue("Proposal title");
    await expect(page.getByLabel("Notes")).toHaveValue("Client-facing notes");
    await expect(page.getByLabel("Currency")).toHaveValue("EUR");
    await expect(page.getByLabel("Discount type")).toHaveValue("FIXED");
    await expect(page.getByLabel("Discount amount")).toHaveValue("10.01");
    await expect(page.getByLabel("Tax rate (%)")).toHaveValue("7.5");
    await expect(page.getByLabel("Tax label")).toHaveValue("VAT");

    const row1 = page.getByRole("group", { name: "Line item 1" });
    await expect(row1.getByLabel("Description")).toHaveValue("Precise item");
    await expect(row1.getByLabel("Qty")).toHaveValue("1.125");
    await expect(row1.getByLabel("Unit price")).toHaveValue("33.33");

    // issueDate + validityDays (30) — a concrete, deterministic value
    // proving the shared-`now` invariant end to end through the UI, not
    // just in the underlying unit test.
    const issueDate = await page.getByLabel("Issue date").inputValue();
    const expected = new Date(`${issueDate}T00:00:00.000Z`);
    expected.setUTCDate(expected.getUTCDate() + 30);
    await expect(page.getByLabel("Valid until")).toHaveValue(expected.toISOString().slice(0, 10));

    // Still an ordinary, unmodified target flow — Client/Lead selection
    // is untouched by applying a template.
    await page.getByRole("radio", { name: "Client" }).check();
    await page.getByLabel("Select client").selectOption({ label: fixtures.clientA.name });
    await expect(page.getByLabel("Select client")).toHaveValue(fixtures.clientA.id);
  });

  test("an archived template shows a generic unavailable notice and a blank form — never a broken page", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.owner);
    const archived = await dbQuery<{ id: string }>("quoteTemplate", "create", {
      data: {
        name: `Archived Template ${fixtures.runId}`,
        currency: "USD",
        discountType: "NONE",
        taxLabel: "TAX",
        archivedAt: new Date().toISOString(),
        organizationId: fixtures.orgA.id,
        createdByUserId: fixtures.owner.id,
        items: { create: [{ description: "Item", quantity: "1", unitPrice: "10.00", position: 0 }] },
      },
    });

    await page.goto(`/quotes/new?template=${archived.id}`);
    await expect(page.getByText("This quote template is unavailable. Starting with a blank quote instead.")).toBeVisible();
    await expect(page.getByLabel("Title")).toHaveValue("");
    await expect(page.getByLabel("Discount type")).toHaveValue("NONE");
  });

  test("a foreign-org template id behaves identically to a nonexistent one — no tenant leakage, same generic notice", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner);
    const foreign = await dbQuery<{ id: string }>("quoteTemplate", "create", {
      data: {
        name: `Org B Secret Template ${fixtures.runId}`,
        currency: "USD",
        discountType: "NONE",
        taxLabel: "TAX",
        organizationId: fixtures.orgB.id,
        createdByUserId: fixtures.orgBOwner.id,
        items: { create: [{ description: "Item", quantity: "1", unitPrice: "10.00", position: 0 }] },
      },
    });

    await page.goto(`/quotes/new?template=${foreign.id}`);
    await expect(page.getByText("This quote template is unavailable. Starting with a blank quote instead.")).toBeVisible();
    await expect(page.getByText("Org B Secret Template", { exact: false })).toHaveCount(0);

    // A malformed id renders the exact same way — never a driver-level
    // error, never a different message that would distinguish it from
    // the foreign-org case above.
    await page.goto(`/quotes/new?template=not-a-real-uuid`);
    await expect(page.getByText("This quote template is unavailable. Starting with a blank quote instead.")).toBeVisible();
  });

  test("MEMBER cannot manage templates but can still see and apply an active one from /quotes/new", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.member);
    await page.goto("/settings/templates");
    await expect(page.getByText("Not available")).toBeVisible();

    await page.goto("/quotes/new");
    const picker = page.getByLabel("Start from a template");
    await expect(picker).toBeVisible();
    await picker.selectOption({ label: `Apply Template ${fixtures.runId}` });
    await expect(page).toHaveURL(new RegExp(`template=${templateId}`));
    await expect(page.getByLabel("Title")).toHaveValue("Proposal title");
  });
});
