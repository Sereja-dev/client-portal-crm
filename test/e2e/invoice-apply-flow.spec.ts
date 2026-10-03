import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Invoice Templates V1 — the /invoices/new?templateId=<id> apply/prefill
 * flow. Real browser coverage for: the "Use template" picker (active-
 * only, hidden when empty, preserves the rest of the URL), prefill
 * correctness (including exact decimal round-tripping and the
 * mode:"itemized" switch), the safe fallback for an archived/foreign/
 * malformed template id (blank form + one generic notice, never a broken
 * page, never a leak of *why*), MEMBER's apply-without-manage permission
 * split, composition with an independent `?clientId=` prefill, the
 * unmodified blank-Invoice regression, and — the one requirement this
 * feature's own spec called out explicitly — that applying a template
 * into the existing Invoice Live Preview panel produces no hydration
 * error (the exact class of regression already fixed once for Invoice
 * Live Preview V1 itself; see that fix's own commit). Mirrors
 * quote-apply-flow.spec.ts's own identical shape and scope discipline.
 * Domain-layer correctness (authorization, tenant isolation, zero-write/
 * snapshot guarantees) is already exhaustively covered by
 * test/integration/invoice-templates/*.test.ts — these tests only prove
 * the UI wires into that already-verified backend correctly.
 */

let fixtures: TestFixtures;
let templateId: string;
let extraInvoiceIds: string[] = [];

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

test.describe("Invoice apply flow (V1)", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterEach(async () => {
    if (extraInvoiceIds.length > 0) {
      await dbQuery("invoice", "deleteMany", { where: { id: { in: extraInvoiceIds } } });
      extraInvoiceIds = [];
    }
  });

  test.afterAll(async () => {
    await dbQuery("invoiceTemplate", "deleteMany", { where: { organizationId: { in: [fixtures.orgA.id, fixtures.orgB.id] } } });
    await cleanupTestData(fixtures);
  });

  test("the picker is hidden when the organization has zero active templates (regression: blank flow is unchanged)", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.owner);
    await page.goto("/invoices/new");
    await expect(page.getByLabel("Start from a template")).toHaveCount(0);
    // Blank flow — today's issue date, flat mode, no discount/tax, exactly
    // as before this feature.
    await expect(page.getByLabel("Issue date")).not.toHaveValue("");
    await expect(page.getByRole("radio", { name: "Flat amount" })).toBeChecked();
  });

  test("selecting a template prefills the form with exact decimal values, switches to itemized, and the Live Preview reflects it with no hydration error", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner);
    const created = await dbQuery<{ id: string }>("invoiceTemplate", "create", {
      data: {
        name: `Apply Template ${fixtures.runId}`,
        notes: "Client-facing notes",
        internalNotes: "Staff-only notes",
        currency: "EUR",
        discountType: "FIXED",
        discountValue: "10.01",
        taxRatePercent: "7.5",
        taxLabel: "VAT",
        dueDateOffsetDays: 30,
        organizationId: fixtures.orgA.id,
        createdByUserId: fixtures.owner.id,
        items: { create: [{ description: "Precise item", quantity: "1.125", unitPrice: "33.33", position: 0 }] },
      },
    });
    templateId = created.id;

    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto("/invoices/new");
    const picker = page.getByLabel("Start from a template");
    await expect(picker).toBeVisible();
    await picker.selectOption({ label: `Apply Template ${fixtures.runId}` });
    await expect(page).toHaveURL(new RegExp(`templateId=${templateId}`));

    // mode is forced to itemized — a template always supplies items.
    await expect(page.getByRole("radio", { name: "Itemized" })).toBeChecked();
    const row1 = page.getByRole("group", { name: "Line item 1" });
    await expect(row1.getByLabel("Description")).toHaveValue("Precise item");
    await expect(row1.getByLabel("Qty")).toHaveValue("1.125");
    await expect(row1.getByLabel("Unit price")).toHaveValue("33.33");

    const preview = page.getByTestId("invoice-preview");
    await expect(preview).toBeVisible();
    await expect(preview.getByText("Precise item")).toBeVisible();
    await expect(preview.getByText("EUR", { exact: true })).toBeVisible();

    const advancedSummary = page.getByText("Advanced options (currency, discount, tax, notes)");
    await advancedSummary.click();
    await expect(page.getByLabel("Currency")).toHaveValue("EUR");
    await expect(page.getByLabel("Discount type")).toHaveValue("FIXED");
    await expect(page.getByLabel("Discount amount")).toHaveValue("10.01");
    await expect(page.getByLabel("Tax rate (%)")).toHaveValue("7.5");
    await expect(page.getByLabel("Tax label")).toHaveValue("VAT");
    await expect(page.getByLabel("Notes", { exact: true })).toHaveValue("Client-facing notes");
    await expect(page.getByLabel("Internal notes")).toHaveValue("Staff-only notes");

    // issueDate + dueDateOffsetDays (30) — a concrete, deterministic value
    // proving the shared-`now` invariant end to end through the UI, not
    // just in the underlying unit test.
    const issueDate = await page.getByLabel("Issue date").inputValue();
    const expected = new Date(`${issueDate}T00:00:00.000Z`);
    expected.setUTCDate(expected.getUTCDate() + 30);
    await expect(page.getByLabel("Due date")).toHaveValue(expected.toISOString().slice(0, 10));

    // Still an ordinary, unmodified target flow — Client selection is
    // untouched by applying a template.
    await page.getByLabel("Client").selectOption(fixtures.clientA.id);
    await expect(preview.getByText(fixtures.clientA.name)).toBeVisible();

    // The whole point of this test: no hydration mismatch from the
    // template's own prefilled dates/decimals reaching the Live Preview's
    // first client render.
    expect(errors).toEqual([]);
  });

  test("an archived template shows a generic unavailable notice and a blank form — never a broken page", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.owner);
    const archived = await dbQuery<{ id: string }>("invoiceTemplate", "create", {
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

    await page.goto(`/invoices/new?templateId=${archived.id}`);
    await expect(page.getByText("This invoice template is unavailable. Starting with a blank invoice instead.")).toBeVisible();
    await expect(page.getByRole("radio", { name: "Flat amount" })).toBeChecked();
    await expect(page.getByLabel("Discount type")).toHaveValue("NONE");
  });

  test("a foreign-org template id behaves identically to a nonexistent one — no tenant leakage, same generic notice", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner);
    const foreign = await dbQuery<{ id: string }>("invoiceTemplate", "create", {
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

    await page.goto(`/invoices/new?templateId=${foreign.id}`);
    await expect(page.getByText("This invoice template is unavailable. Starting with a blank invoice instead.")).toBeVisible();
    await expect(page.getByText("Org B Secret Template", { exact: false })).toHaveCount(0);

    // A malformed id renders the exact same way — never a driver-level
    // error, never a different message that would distinguish it from
    // the foreign-org case above.
    await page.goto(`/invoices/new?templateId=not-a-real-uuid`);
    await expect(page.getByText("This invoice template is unavailable. Starting with a blank invoice instead.")).toBeVisible();
  });

  test("MEMBER cannot manage templates but can still see and apply an active one from /invoices/new", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.member);
    await page.goto("/settings/invoice-templates");
    await expect(page.getByText("Not available")).toBeVisible();

    await page.goto("/invoices/new");
    const picker = page.getByLabel("Start from a template");
    await expect(picker).toBeVisible();
    await picker.selectOption({ label: `Apply Template ${fixtures.runId}` });
    await expect(page).toHaveURL(new RegExp(`templateId=${templateId}`));
    await expect(page.getByLabel("Notes", { exact: true })).toHaveValue("Client-facing notes");
  });

  test("composes with an independent ?clientId= prefill — the template never supplies the client, so both apply together", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner);
    await page.goto(`/invoices/new?templateId=${templateId}&clientId=${fixtures.clientA.id}`);
    await expect(page.getByLabel("Client")).toHaveValue(fixtures.clientA.id);
    const row1 = page.getByRole("group", { name: "Line item 1" });
    await expect(row1.getByLabel("Description")).toHaveValue("Precise item");
  });

  // The mobile line-item overflow fix (src/components/invoices/
  // invoice-form.tsx's own top-level grid wrapper, now an explicit
  // `grid-cols-1` base below `lg:`) closed the pre-existing,
  // Templates-independent defect this test previously had to work
  // around — restored to the same strict zero-page-overflow assertion
  // every other responsive test in this feature uses. Applying a
  // template necessarily switches the form to itemized mode with real
  // values, which is exactly the case the fix targets.
  test("390x900: the templated new-invoice form and its Live Preview both fit, no page-level horizontal overflow", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.owner);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/invoices/new?templateId=${templateId}`);

    await expect(page.getByRole("heading", { name: "Add invoice", level: 1 })).toBeVisible();
    await expect(page.getByTestId("invoice-preview")).toBeVisible();
    const row1 = page.getByRole("group", { name: "Line item 1" });
    await expect(row1.getByLabel("Description")).toBeVisible();
    await expect(row1.getByLabel("Description")).toHaveValue("Precise item");

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);

    await expect(page.getByRole("button", { name: "Create invoice" })).toBeVisible();
  });
});
