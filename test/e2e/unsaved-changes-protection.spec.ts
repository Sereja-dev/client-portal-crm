import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";
import { selectSearchableOption } from "../support/select-searchable-option";

/**
 * Forms Improvement Slice C1a — unsaved-change protection for Invoice,
 * Recurring Invoice, and Quote. Per-field CRUD/lifecycle/template/
 * duplicate/live-preview behavior is already exhaustively covered
 * elsewhere (invoices.spec.ts, recurring-invoice-*.spec.ts,
 * quotes.spec.ts, quote-apply-flow.spec.ts, quote-live-preview.spec.ts,
 * invoice-live-preview.spec.ts) and re-run alongside this file, not
 * repeated here. This file covers only the new guard's own behavior:
 * pristine vs. dirty Cancel/Back, Stay/Leave, revert-to-baseline,
 * validation-error persistence, and (Recurring) that the Advanced
 * disclosure's own open/closed state never counts as dirty by itself.
 *
 * Explicitly NOT covered here, per this slice's own readiness-audit
 * scope boundary (Forms Improvement Slice C1's own §N/§O): sidebar/
 * top-nav interception, or browser Back/Forward — this guard protects
 * exactly two surfaces, the form's own explicit Cancel/Back control and
 * hard browser unload (not practically automatable here — browsers own
 * and ignore any custom `beforeunload` prompt text, and Playwright's own
 * default behavior is to auto-dismiss that native dialog without a
 * scriptable hook into its registration state from the page side).
 */

let fixtures: TestFixtures;
let extraInvoiceIds: string[] = [];
let extraScheduleIds: string[] = [];
let extraQuoteIds: string[] = [];

async function actAs(
  context: BrowserContext,
  baseURL: string,
  identity: { id: string; email: string },
  organizationId: string,
): Promise<void> {
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

test.describe("Unsaved-change protection (Forms Improvement Slice C1a)", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterEach(async () => {
    if (extraInvoiceIds.length > 0) {
      await dbQuery("invoice", "deleteMany", { where: { id: { in: extraInvoiceIds } } });
      extraInvoiceIds = [];
    }
    if (extraScheduleIds.length > 0) {
      await dbQuery("recurringInvoice", "deleteMany", { where: { id: { in: extraScheduleIds } } });
      extraScheduleIds = [];
    }
    if (extraQuoteIds.length > 0) {
      await dbQuery("quote", "deleteMany", { where: { id: { in: extraQuoteIds } } });
      extraQuoteIds = [];
    }
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test.describe("Invoice", () => {
    test("pristine create form: Cancel navigates immediately, no dialog", async ({ context, baseURL, page }) => {
      await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      await page.goto("/invoices/new");

      await page.getByRole("link", { name: "Cancel" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page).toHaveURL(/\/invoices(\?|$)/);
    });

    test("dirty create form: Cancel opens a confirm dialog; Stay preserves the typed value; Leave then navigates", async ({
      context,
      baseURL,
      page,
    }) => {
      await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      await page.goto("/invoices/new");

      await page.getByLabel("Invoice number").fill("UNSAVED-TEST-1");
      await page.getByRole("link", { name: "Cancel" }).click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText("Leave without saving?")).toBeVisible();

      await dialog.getByRole("button", { name: "Stay" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page).toHaveURL(/\/invoices\/new/);
      await expect(page.getByLabel("Invoice number")).toHaveValue("UNSAVED-TEST-1");

      await page.getByRole("link", { name: "Cancel" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Leave" }).click();
      await expect(page).toHaveURL(/\/invoices(\?|$)/);
    });

    test("reverting the only edited field back to its original value makes the form clean again — Cancel navigates with no dialog", async ({
      context,
      baseURL,
      page,
    }) => {
      await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      await page.goto("/invoices/new");

      const field = page.getByLabel("Invoice number");
      await expect(field).toHaveValue("");
      await field.fill("Temporary");
      await field.fill("");

      await page.getByRole("link", { name: "Cancel" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page).toHaveURL(/\/invoices(\?|$)/);
    });

    test("a real server validation error leaves the form dirty — Cancel still warns after the failed submit", async ({
      context,
      baseURL,
      page,
    }) => {
      await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      await page.goto("/invoices/new");

      await selectSearchableOption(page, "Client", fixtures.clientA.name, fixtures.clientA.name);
      await page.getByLabel("Invoice number").fill(`UNSAVED-ERR-${fixtures.runId}`);
      await page.getByRole("textbox", { name: "Amount" }).fill("100.00");
      await page.getByLabel("Issue date").fill("2027-01-01");

      // Existing, real server validation rule (not invented for this
      // test) — tax rate has no client-side `required`/range attribute,
      // so an out-of-range value genuinely reaches the server.
      await page.getByText("Advanced options (currency, discount, tax, notes)").click();
      await page.getByLabel("Tax rate (%)").fill("150");
      await page.getByRole("button", { name: "Create invoice" }).click();
      await expect(page.getByText("Enter a tax rate between 0 and 100.")).toBeVisible();

      await page.getByRole("link", { name: "Cancel" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByRole("dialog").getByRole("button", { name: "Stay" }).click();
      // The just-typed value survived the failed submit (existing
      // controlled-state behavior, unchanged by this slice) and the
      // guard is still protecting it.
      await expect(page.getByLabel("Invoice number")).toHaveValue(`UNSAVED-ERR-${fixtures.runId}`);
    });
  });

  test.describe("Recurring Invoice", () => {
    test("pristine create form: Cancel navigates immediately, no dialog", async ({ context, baseURL, page }) => {
      await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      await page.goto("/recurring-invoices/new");

      await page.getByRole("link", { name: "Cancel" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page).toHaveURL(/\/recurring-invoices(\?|$)/);
    });

    test("dirty create form: Cancel warns; Stay preserves the value; reverting it makes the form clean again", async ({
      context,
      baseURL,
      page,
    }) => {
      await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      await page.goto("/recurring-invoices/new");

      const nameField = page.getByLabel("Name");
      await nameField.fill("Unsaved schedule name");
      await page.getByRole("link", { name: "Cancel" }).click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Stay" }).click();
      await expect(nameField).toHaveValue("Unsaved schedule name");

      await nameField.fill("");
      await page.getByRole("link", { name: "Cancel" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page).toHaveURL(/\/recurring-invoices(\?|$)/);
    });

    test("opening and closing the Advanced disclosure alone never makes the form dirty", async ({ context, baseURL, page }) => {
      await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      await page.goto("/recurring-invoices/new");

      const advancedSummary = page.getByText("Advanced options (discount, tax, notes)");
      await advancedSummary.click();
      await expect(page.getByLabel("Discount type")).toBeVisible();
      await advancedSummary.click();
      await expect(page.getByLabel("Discount type")).not.toBeVisible();

      await page.getByRole("link", { name: "Cancel" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page).toHaveURL(/\/recurring-invoices(\?|$)/);
    });

    test("editing an Advanced field DOES make the form dirty", async ({ context, baseURL, page }) => {
      await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      await page.goto("/recurring-invoices/new");

      await page.getByText("Advanced options (discount, tax, notes)").click();
      await page.getByLabel("Notes", { exact: true }).fill("Unsaved note");

      await page.getByRole("link", { name: "Cancel" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByRole("dialog").getByRole("button", { name: "Stay" }).click();
      await expect(page.getByLabel("Notes", { exact: true })).toHaveValue("Unsaved note");
    });

    test("a real server validation error leaves the form dirty — Cancel still warns after the failed submit", async ({
      context,
      baseURL,
      page,
    }) => {
      await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      await page.goto("/recurring-invoices/new");

      await selectSearchableOption(page, "Client", fixtures.clientA.name, fixtures.clientA.name);
      await page.getByLabel("Name").fill(`UNSAVED-ERR-${fixtures.runId}`);
      await page.getByLabel("First issue date").fill("2027-01-01");
      await page.getByLabel("Invoice number prefix").fill(`UE-${fixtures.runId}-`);

      const row1 = page.getByRole("group", { name: "Line item 1" });
      await row1.getByLabel("Description").fill("Retainer");
      await row1.getByLabel("Qty").fill("1");
      await row1.getByLabel("Unit price").fill("50.00");

      await page.getByText("Advanced options (discount, tax, notes)").click();
      await page.getByLabel("Tax rate (%)").fill("150");
      await page.getByRole("button", { name: "Create schedule" }).click();
      await expect(page.getByText("Enter a tax rate between 0 and 100.")).toBeVisible();

      await page.getByRole("link", { name: "Cancel" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByRole("dialog").getByRole("button", { name: "Stay" }).click();
      await expect(page.getByLabel("Name")).toHaveValue(`UNSAVED-ERR-${fixtures.runId}`);
    });
  });

  test.describe("Quote", () => {
    test("pristine create form: Cancel navigates immediately, no dialog", async ({ context, baseURL, page }) => {
      await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      await page.goto("/quotes/new");

      await page.getByRole("link", { name: "Cancel" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page).toHaveURL(/\/quotes(\?|$)/);
    });

    test("dirty create form: Cancel warns; Stay preserves the value; reverting it makes the form clean again", async ({
      context,
      baseURL,
      page,
    }) => {
      await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      await page.goto("/quotes/new");

      // Quote number's own baseline is a real, server-suggested value
      // (unlike Invoice's blank default) — captured here so "revert"
      // means restoring that exact value, not merely clearing the field.
      const numberField = page.getByLabel("Quote number");
      const suggestedNumber = await numberField.inputValue();
      await numberField.fill("UNSAVED-Q-1");
      await page.getByRole("link", { name: "Cancel" }).click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Stay" }).click();
      await expect(numberField).toHaveValue("UNSAVED-Q-1");

      await numberField.fill(suggestedNumber);
      await page.getByRole("link", { name: "Cancel" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page).toHaveURL(/\/quotes(\?|$)/);
    });

    test("DRAFT edit: the persisted-value baseline begins clean, Back navigates with no dialog", async ({
      context,
      baseURL,
      page,
    }) => {
      await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      const quote = await dbQuery<{ id: string }>("quote", "create", {
        data: {
          number: `UNSAVED-Q-DRAFT-${Date.now()}`,
          status: "DRAFT",
          organizationId: fixtures.orgA.id,
          createdByUserId: fixtures.owner.id,
          clientId: fixtures.clientA.id,
          subtotal: "10.00",
          discountAmount: "0.00",
          taxAmount: "0.00",
          total: "10.00",
          items: { create: [{ description: "Seeded item", quantity: "1", unitPrice: "10.00", lineTotal: "10.00", position: 0 }] },
        },
      });
      extraQuoteIds.push(quote.id);

      await page.goto(`/quotes/${quote.id}/edit`);
      await page.getByRole("link", { name: "Back" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page).toHaveURL(/\/quotes(\?|$)/);
    });

    test("duplicate: the prefilled baseline begins clean (never compared against the source Quote); Cancel navigates with no dialog", async ({
      context,
      baseURL,
      page,
    }) => {
      await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      const source = await dbQuery<{ id: string }>("quote", "create", {
        data: {
          number: `UNSAVED-Q-SRC-${Date.now()}`,
          status: "DRAFT",
          organizationId: fixtures.orgA.id,
          createdByUserId: fixtures.owner.id,
          clientId: fixtures.clientA.id,
          subtotal: "10.00",
          discountAmount: "0.00",
          taxAmount: "0.00",
          total: "10.00",
          items: { create: [{ description: "Seeded item", quantity: "1", unitPrice: "10.00", lineTotal: "10.00", position: 0 }] },
        },
      });
      extraQuoteIds.push(source.id);

      await page.goto(`/quotes/${source.id}/duplicate`);
      await page.getByRole("link", { name: "Cancel" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page).toHaveURL(/\/quotes(\?|$)/);
    });

    test("SENT-live: confirming Edit quote mounts a clean form; editing it afterward DOES make it dirty", async ({
      context,
      baseURL,
      page,
    }) => {
      await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      const quote = await dbQuery<{ id: string }>("quote", "create", {
        data: {
          number: `UNSAVED-Q-SENT-${Date.now()}`,
          status: "SENT",
          sentAt: new Date().toISOString(),
          validUntil: "2099-01-01T00:00:00.000Z",
          organizationId: fixtures.orgA.id,
          createdByUserId: fixtures.owner.id,
          clientId: fixtures.clientA.id,
          subtotal: "10.00",
          discountAmount: "0.00",
          taxAmount: "0.00",
          total: "10.00",
          items: { create: [{ description: "Seeded item", quantity: "1", unitPrice: "10.00", lineTotal: "10.00", position: 0 }] },
        },
      });
      extraQuoteIds.push(quote.id);

      await page.goto(`/quotes/${quote.id}/edit`);
      await page.getByRole("button", { name: "Edit quote" }).click();
      await page.getByRole("button", { name: "Edit anyway" }).click();

      // Freshly mounted QuoteForm — clean baseline, Back navigates
      // directly with no confirm.
      await page.getByRole("link", { name: "Back" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page).toHaveURL(/\/quotes(\?|$)/);

      // Re-enter and actually edit a field this time.
      await page.goto(`/quotes/${quote.id}/edit`);
      await page.getByRole("button", { name: "Edit quote" }).click();
      await page.getByRole("button", { name: "Edit anyway" }).click();
      await page.getByLabel("Title").fill("Unsaved title edit");

      await page.getByRole("link", { name: "Back" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByRole("dialog").getByRole("button", { name: "Stay" }).click();
      await expect(page.getByLabel("Title")).toHaveValue("Unsaved title edit");
    });

    test("a real server validation error leaves the form dirty — Cancel still warns after the failed submit", async ({
      context,
      baseURL,
      page,
    }) => {
      await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
      await page.goto("/quotes/new");

      await page.getByLabel("Quote number").fill(`UNSAVED-Q-ERR-${fixtures.runId}`);
      await page.getByRole("radio", { name: "Client" }).check();
      await selectSearchableOption(page, "Select client", fixtures.clientA.name, fixtures.clientA.name);
      await page.getByLabel("Issue date").fill("2027-01-01");

      const row1 = page.getByRole("group", { name: "Line item 1" });
      await row1.getByLabel("Description").fill("Design");
      await row1.getByLabel("Qty").fill("1");
      await row1.getByLabel("Unit price").fill("50.00");

      await page.getByLabel("Tax rate (%)").fill("150");
      await page.getByRole("button", { name: "Create quote" }).click();
      await expect(page.getByText("Enter a tax rate between 0 and 100.")).toBeVisible();

      await page.getByRole("link", { name: "Cancel" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByRole("dialog").getByRole("button", { name: "Stay" }).click();
      await expect(page.getByLabel("Quote number")).toHaveValue(`UNSAVED-Q-ERR-${fixtures.runId}`);
    });
  });
});
