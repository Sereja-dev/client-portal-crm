import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";
import { selectSearchableOption } from "../support/select-searchable-option";

/**
 * Forms Improvement Slice B1 — real-browser coverage for the new
 * Recurring Invoice form sections and "Advanced options" progressive
 * disclosure. Per-field create/edit/relation-selector/numbering
 * behavior already has dedicated coverage elsewhere
 * (recurring-invoice-relational-selectors.spec.ts, the integration
 * suite); this file covers only what's new here: the section headings
 * themselves, the disclosure's default/auto-open/user-controlled
 * behavior, and that opening/closing it never loses or resets anything.
 */

let fixtures: TestFixtures;
const extraScheduleIds: string[] = [];

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

function trackErrors(page: Page): { errors: () => string[] } {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));
  return { errors: () => [...consoleErrors, ...pageErrors] };
}

function assertNoHydrationErrors(errors: string[]): void {
  const hydrationRelated = errors.filter((text) => /hydrat|#418|did not match|server-rendered/i.test(text));
  expect(hydrationRelated).toEqual([]);
}

test.describe("Forms Improvement Slice B1 — Recurring Invoice form sections", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    if (extraScheduleIds.length > 0) {
      await dbQuery("recurringInvoice", "deleteMany", { where: { id: { in: extraScheduleIds } } });
    }
    await cleanupTestData(fixtures);
  });

  test("create: sections render in order, Advanced options is closed by default, relation selectors and numbering still work, closing/reopening Advanced preserves entered values, no hydration error", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    const tracker = trackErrors(page);

    await page.goto("/recurring-invoices/new");

    // Section order.
    const headings = await page.locator("legend").allTextContents();
    expect(headings).toEqual(["Schedule", "Invoice numbering & due date", "Invoice contents"]);

    // Advanced options closed by default on a clean create form.
    const advancedSummary = page.getByText("Advanced options (discount, tax, notes)");
    await expect(advancedSummary).toBeVisible();
    await expect(page.getByLabel("Discount type")).not.toBeVisible();

    // Relation selectors (A2.2, already Production-verified) still work
    // inside the new "Schedule" section.
    await selectSearchableOption(page, "Client", fixtures.clientA.name, fixtures.clientA.name);
    await expect(page.getByRole("combobox", { name: "Project" })).toBeEnabled();

    // Numbering section still works.
    await page.getByLabel("Invoice number prefix").fill("B1-");
    await expect(page.getByText(/Next invoice: B1-/)).toBeVisible();

    // Open Advanced, enter a value, close it, reopen — value survives
    // (native <details> never unmounts its children on close).
    await advancedSummary.click();
    await page.getByLabel("Tax rate (%)").fill("7.5");
    await advancedSummary.click();
    await expect(page.getByLabel("Tax rate (%)")).not.toBeVisible();
    await advancedSummary.click();
    await expect(page.getByLabel("Tax rate (%)")).toHaveValue("7.5");

    // Entering an Advanced value never reset unrelated fields in other sections.
    await expect(page.getByLabel("Invoice number prefix")).toHaveValue("B1-");

    assertNoHydrationErrors(tracker.errors());
  });

  test("edit: a schedule with only default advanced values keeps Advanced collapsed initially", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);

    const schedule = await dbQuery<{ id: string }>("recurringInvoice", "create", {
      data: {
        name: "B1 default-advanced schedule",
        organizationId: fixtures.orgA.id,
        clientId: fixtures.clientA.id,
        frequency: "MONTHLY",
        anchorDay: 1,
        nextIssueDate: new Date(),
        invoiceNumberPrefix: `B1-DEFAULT-${Date.now()}-`,
        nextSequence: 1,
        currency: "USD",
        status: "ACTIVE",
        lineItems: { create: [{ description: "Retainer", quantity: "1", unitPrice: "10.00", position: 0 }] },
      },
    });
    extraScheduleIds.push(schedule.id);

    await page.goto(`/recurring-invoices/${schedule.id}/edit`);
    await expect(page.getByLabel("Discount type")).not.toBeVisible();
  });

  test("edit: a schedule with persisted advanced values (discount, tax, notes, internal notes) opens Advanced automatically, with every value correct", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    const tracker = trackErrors(page);

    const schedule = await dbQuery<{ id: string }>("recurringInvoice", "create", {
      data: {
        name: "B1 advanced-values schedule",
        organizationId: fixtures.orgA.id,
        clientId: fixtures.clientA.id,
        frequency: "MONTHLY",
        anchorDay: 1,
        nextIssueDate: new Date(),
        invoiceNumberPrefix: `B1-ADV-${Date.now()}-`,
        nextSequence: 1,
        currency: "USD",
        status: "ACTIVE",
        discountType: "PERCENTAGE",
        discountValue: "10",
        taxRatePercent: "8.25",
        taxLabel: "VAT",
        notes: "Thanks for your continued business.",
        internalNotes: "VIP account — escalate to finance if unpaid.",
        lineItems: { create: [{ description: "Retainer", quantity: "1", unitPrice: "10.00", position: 0 }] },
      },
    });
    extraScheduleIds.push(schedule.id);

    await page.goto(`/recurring-invoices/${schedule.id}/edit`);

    // No blank/first-option flash — the persisted values are correct and
    // visible immediately, without the user needing to open anything.
    await expect(page.getByLabel("Discount type")).toBeVisible();
    await expect(page.getByLabel("Discount type")).toHaveValue("PERCENTAGE");
    await expect(page.getByLabel("Discount (%)")).toHaveValue("10");
    await expect(page.getByLabel("Tax rate (%)")).toHaveValue("8.25");
    await expect(page.getByLabel("Tax label")).toHaveValue("VAT");
    // "Notes" is a case-insensitive substring of "Internal notes" —
    // exact match avoids the same ambiguous-label collision this
    // session's own A2.1/A2.2 work already learned about.
    await expect(page.getByLabel("Notes", { exact: true })).toHaveValue("Thanks for your continued business.");
    await expect(page.getByLabel("Internal notes")).toHaveValue("VIP account — escalate to finance if unpaid.");

    assertNoHydrationErrors(tracker.errors());
  });

  test("validation error on an Advanced field (out-of-range tax rate) keeps Advanced open after the server round-trip, with the error visible, AND every other unsaved value across every control type — including the native-select validation-reset remediation fields — survives intact", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    const tracker = trackErrors(page);

    await page.goto("/recurring-invoices/new");
    await selectSearchableOption(page, "Client", fixtures.clientA.name, fixtures.clientA.name);
    await page.getByLabel("Name").fill("B1 unsaved schedule name");
    await page.getByLabel("Frequency").selectOption("WEEKLY");
    await page.getByLabel("First issue date").fill("2027-01-01");
    await page.getByLabel("Invoice number prefix").fill(`B1-ERR-${fixtures.runId}`);
    await page.getByLabel("Due date offset (days)").fill("10");

    const row1 = page.getByRole("group", { name: "Line item 1" });
    await row1.getByLabel("Description").fill("Retainer");
    await row1.getByLabel("Qty").fill("1");
    await row1.getByLabel("Unit price").fill("50.00");

    // Open Advanced and set a discount + an out-of-range tax rate — the
    // tax-rate rule is an existing, real server-side validation rule
    // (src/lib/validation/recurring-invoice.ts: "Enter a tax rate
    // between 0 and 100."), not invented for this test. Deliberately
    // NOT the discount-value scenario as the TRIGGER: that field only
    // becomes `required` once a discount type is chosen, and the
    // browser's own native HTML5 constraint validation blocks the
    // request before it ever reaches the server — true before B1 too.
    // Tax rate has no `required` attribute, so an out-of-range value
    // genuinely reaches the server, while Discount type/value (set here
    // too) ride along as unrelated fields that must survive the error.
    await page.getByText("Advanced options (discount, tax, notes)").click();
    await page.getByLabel("Discount type").selectOption("FIXED");
    await page.getByLabel("Discount amount").fill("5.00");
    await page.getByLabel("Tax label").selectOption("VAT");
    await page.getByLabel("Notes", { exact: true }).fill("B1 unsaved public note");
    await page.getByLabel("Internal notes").fill("B1 unsaved internal note");
    await page.getByLabel("Tax rate (%)").fill("150");

    await page.getByRole("button", { name: "Create schedule" }).click();
    await expect(page.getByText("Enter a tax rate between 0 and 100.")).toBeVisible();

    // Advanced remains open after the round-trip — the error is visible,
    // not hidden behind a collapsed section.
    await expect(page.getByLabel("Tax rate (%)")).toBeVisible();

    // Every unsaved value across every control type survives — this is
    // the validation-reset remediation's own invariant, and B1's own
    // sectioning/disclosure restructuring must not have reintroduced the
    // defect it fixed. Frequency and Discount type in particular are
    // native <select> elements covered by the remediation's consolidated
    // post-settlement re-apply effect — the exact DOM-desync class that
    // was broken before that fix.
    await expect(page.getByLabel("Name")).toHaveValue("B1 unsaved schedule name");
    await expect(page.getByLabel("Frequency")).toHaveValue("WEEKLY");
    await expect(page.getByLabel("Invoice number prefix")).toHaveValue(`B1-ERR-${fixtures.runId}`);
    await expect(page.getByLabel("Due date offset (days)")).toHaveValue("10");
    await expect(page.getByLabel("Discount type")).toHaveValue("FIXED");
    await expect(page.getByLabel("Discount amount")).toHaveValue("5.00");
    await expect(page.getByLabel("Tax label")).toHaveValue("VAT");
    await expect(page.getByLabel("Notes", { exact: true })).toHaveValue("B1 unsaved public note");
    await expect(page.getByLabel("Internal notes")).toHaveValue("B1 unsaved internal note");

    assertNoHydrationErrors(tracker.errors());
  });

  test("390x900: sections stack correctly, Advanced summary fits, open Advanced content causes no destructive horizontal overflow, and relation/currency controls remain usable", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/recurring-invoices/new");

    await expect(page.locator("legend").first()).toBeVisible();
    const overflowBefore = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflowBefore).toBe(false);

    await page.getByText("Advanced options (discount, tax, notes)").click();
    await page.getByLabel("Discount type").selectOption("FIXED");
    await expect(page.getByLabel("Discount amount")).toBeVisible();

    const overflowAfter = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflowAfter).toBe(false);

    await selectSearchableOption(page, "Client", fixtures.clientA.name, fixtures.clientA.name);
    await expect(page.getByRole("combobox", { name: "Currency" })).toBeVisible();
  });
});
