import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";
import { selectSearchableOption } from "../support/select-searchable-option";

/**
 * Invoice internal-notes validation-reset remediation — real-browser
 * proof that `internalNotes` (the one field in InvoiceForm that was
 * still uncontrolled, `defaultValue`-bound) now survives a Server
 * Action validation-error settlement in both create and edit mode.
 * Before this fix, React 19's `useActionState` triggers a native
 * `form.reset()` on every action settlement (success or rejection
 * alike); a controlled field survives because the next render repaints
 * it from React state, but an uncontrolled field's `defaultValue` prop
 * never changes to reflect what was just submitted, so the native reset
 * silently discarded it — even when the validation error was on a
 * completely unrelated field. Reproduced against the exact unmodified
 * pre-fix baseline before any code change; this file is the permanent
 * regression proof that it stays fixed. Mirrors the identical remediation
 * already proven for Recurring Invoice's own formerly-uncontrolled
 * fields (recurring-invoice-validation-reset.spec.ts).
 */

let fixtures: TestFixtures;
const extraInvoiceIds: string[] = [];

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

test.describe("Invoice internal notes — validation-error field persistence", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    if (extraInvoiceIds.length > 0) {
      await dbQuery("invoice", "deleteMany", { where: { id: { in: extraInvoiceIds } } });
    }
    await cleanupTestData(fixtures);
  });

  test("create: an unsaved Internal notes value survives an unrelated server validation error", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/invoices/new");

    await selectSearchableOption(page, "Client", fixtures.clientA.name, fixtures.clientA.name);
    await page.getByLabel("Invoice number").fill(`IN-RESET-${fixtures.runId}`);
    await page.getByRole("textbox", { name: "Amount" }).fill("100.00");
    await page.getByLabel("Issue date").fill("2027-01-01");

    await page.getByText("Advanced options (currency, discount, tax, notes)").click();
    await page.getByLabel("Internal notes").fill("Unsaved internal note — do not lose this");

    // An existing, real, currently-triggerable server validation rule
    // (src/lib/validation/invoice.ts: "Enter a tax rate between 0 and
    // 100.") — not invented for this test. Tax rate has no client-side
    // `required`/range attribute, so this genuinely reaches the server.
    await page.getByLabel("Tax rate (%)").fill("150");
    await page.getByRole("button", { name: "Create invoice" }).click();
    await expect(page.getByText("Enter a tax rate between 0 and 100.")).toBeVisible();

    // The unrelated, previously-uncontrolled field's user-entered value
    // survived the settlement — the whole point of this fix.
    await expect(page.getByLabel("Internal notes")).toHaveValue("Unsaved internal note — do not lose this");

    // Fields outside the affected set are of course unaffected too.
    await expect(page.getByLabel("Invoice number")).toHaveValue(`IN-RESET-${fixtures.runId}`);
  });

  test("edit: modifying Internal notes and triggering an unrelated validation error keeps the UNSAVED edit visible — not the original persisted value — and the DB record stays unchanged because the save failed", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);

    const invoiceNumber = `IN-RESET-EDIT-${Date.now()}`;
    const draft = await dbQuery<{ id: string }>("invoice", "create", {
      data: {
        invoiceNumber,
        organizationId: fixtures.orgA.id,
        clientId: fixtures.clientA.id,
        amount: "50.00",
        subtotal: "50.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        currency: "USD",
        status: "DRAFT",
        issueDate: new Date(),
        internalNotes: "Original persisted internal note",
      },
    });
    extraInvoiceIds.push(draft.id);

    await page.goto(`/invoices/${draft.id}/edit`);

    // Persisted value renders correctly on first load.
    await page.getByText("Advanced options (currency, discount, tax, notes)").click();
    await expect(page.getByLabel("Internal notes")).toHaveValue("Original persisted internal note");

    // Edit it.
    await page.getByLabel("Internal notes").fill("Unsaved edited internal note");

    // Trigger an unrelated server validation error.
    await page.getByLabel("Tax rate (%)").fill("150");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Enter a tax rate between 0 and 100.")).toBeVisible();

    // The UNSAVED edit remains visible — not the original persisted
    // value. Reverting to the persisted value would look superficially
    // "valid" (a real stored value, not blank) while still silently
    // discarding the user's in-progress edit — exactly the subtler
    // failure mode this edit-mode case is designed to catch.
    await expect(page.getByLabel("Internal notes")).toHaveValue("Unsaved edited internal note");

    // The DB record itself is untouched — the save genuinely failed server-side.
    const unchanged = await dbQuery<{ internalNotes: string | null }>("invoice", "findUniqueOrThrow", {
      where: { id: draft.id },
    });
    expect(unchanged.internalNotes).toBe("Original persisted internal note");
  });

  test("successful create: the controlled Internal notes value is submitted correctly", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);

    await page.goto("/invoices/new");
    await selectSearchableOption(page, "Client", fixtures.clientA.name, fixtures.clientA.name);
    const invoiceNumber = `IN-RESET-OK-${fixtures.runId}`;
    await page.getByLabel("Invoice number").fill(invoiceNumber);
    await page.getByRole("textbox", { name: "Amount" }).fill("75.00");
    await page.getByLabel("Issue date").fill("2027-02-01");

    await page.getByText("Advanced options (currency, discount, tax, notes)").click();
    await page.getByLabel("Internal notes").fill("Submitted internal note");

    await page.getByRole("button", { name: "Create invoice" }).click();
    await expect(page).toHaveURL(/\/invoices(\?|$|\/)/);

    const created = await dbQuery<{ internalNotes: string | null }>("invoice", "findFirstOrThrow", {
      where: { invoiceNumber },
    });
    extraInvoiceIds.push((created as unknown as { id: string }).id ?? "");

    expect(created.internalNotes).toBe("Submitted internal note");
  });
});
