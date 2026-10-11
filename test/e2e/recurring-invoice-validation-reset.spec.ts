import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";
import { selectSearchableOption } from "../support/select-searchable-option";

/**
 * Recurring Invoice validation-reset remediation — real-browser proof
 * that every category-B (previously uncontrolled, `defaultValue`-bound)
 * field now survives a Server Action validation-error settlement in
 * both create and edit mode. Before the fix, React 19's `useActionState`
 * triggers a native `form.reset()` on every action settlement
 * (success or rejection alike); a controlled field survives because the
 * next render repaints it from React state, but an uncontrolled field's
 * `defaultValue` prop never changes to reflect what was just submitted,
 * so the native reset silently discards it. Reproduced against the
 * exact unmodified pre-fix baseline before any code change (confirmed
 * in the task's own write-up); this file is the permanent regression
 * proof that it stays fixed.
 *
 * Corrective pass — a comprehensive field-by-field inventory (every
 * user-editable field, not just the original six) found two more
 * fields that still reverted after the fix above: `frequency` and
 * `discountType`. Both are native `<select>` elements that were ALREADY
 * controlled (`value`/`onChange`, React state never actually lost the
 * user's choice) — the same deeper, `<select>`-specific DOM/React
 * desync already diagnosed and fixed for `taxLabel`: the native reset
 * mutates the DOM's `selectedIndex` out of band, and React's own
 * update path for `<select>` doesn't reliably notice and re-push the
 * value afterward. The tests below cover that gap, plus the specific
 * correctness bar it raises (a stale DOM `<select>` value would be
 * silently submitted on a subsequent resubmission even though every
 * other part of the UI still correctly reflects the user's real
 * choice) and a comprehensive multi-control-type sweep.
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

test.describe("Recurring Invoice — validation-error field persistence", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    if (extraScheduleIds.length > 0) {
      await dbQuery("recurringInvoice", "deleteMany", { where: { id: { in: extraScheduleIds } } });
    }
    await cleanupTestData(fixtures);
  });

  test("create: every previously-uncontrolled field (name, firstIssueDate, dueDateOffsetDays, taxLabel, notes, internalNotes) survives an unrelated server validation error", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    const tracker = trackErrors(page);

    await page.goto("/recurring-invoices/new");

    await selectSearchableOption(page, "Client", fixtures.clientA.name, fixtures.clientA.name);
    await page.getByLabel("Name").fill("Edited schedule name");
    await page.getByLabel("First issue date").fill("2027-02-01");
    await page.getByLabel("Invoice number prefix").fill(`RESET-${fixtures.runId}`);
    await page.getByLabel("Due date offset (days)").fill("10");

    const row1 = page.getByRole("group", { name: "Line item 1" });
    await row1.getByLabel("Description").fill("Retainer");
    await row1.getByLabel("Qty").fill("1");
    await row1.getByLabel("Unit price").fill("50.00");

    await page.getByLabel("Tax label").selectOption("VAT");
    await page.getByLabel("Notes", { exact: true }).fill("Public note — thanks for your business.");
    await page.getByLabel("Internal notes").fill("Unsaved changed internal note");

    // An existing, real, currently-triggerable server validation rule
    // (src/lib/validation/recurring-invoice.ts: "Enter a tax rate
    // between 0 and 100.") — not invented for this test. Tax rate has
    // no client-side `required` attribute, so this genuinely reaches
    // the server, unlike the discount-value field (which IS `required`
    // once a discount type is chosen, so the browser's own native
    // constraint validation would block submission before ever
    // reaching the server — not usable as a reproduction path here).
    await page.getByLabel("Tax rate (%)").fill("150");

    await page.getByRole("button", { name: "Create schedule" }).click();
    await expect(page.getByText("Enter a tax rate between 0 and 100.")).toBeVisible();

    // Every unrelated, previously-uncontrolled field's user-entered
    // value survived the settlement — the whole point of this fix.
    await expect(page.getByLabel("Name")).toHaveValue("Edited schedule name");
    await expect(page.getByLabel("First issue date")).toHaveValue("2027-02-01");
    await expect(page.getByLabel("Due date offset (days)")).toHaveValue("10");
    await expect(page.getByLabel("Tax label")).toHaveValue("VAT");
    await expect(page.getByLabel("Notes", { exact: true })).toHaveValue("Public note — thanks for your business.");
    await expect(page.getByLabel("Internal notes")).toHaveValue("Unsaved changed internal note");

    // Fields outside the affected set are of course unaffected too.
    await expect(page.getByLabel("Invoice number prefix")).toHaveValue(`RESET-${fixtures.runId}`);
    await expect(page.getByRole("combobox", { name: "Client" })).toHaveValue(fixtures.clientA.name);

    assertNoHydrationErrors(tracker.errors());
  });

  test("edit: modifying previously-uncontrolled fields and triggering an unrelated validation error keeps the UNSAVED edits visible — not the original persisted values — and the DB record stays unchanged because the save failed", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    const tracker = trackErrors(page);

    const schedule = await dbQuery<{ id: string }>("recurringInvoice", "create", {
      data: {
        name: "Original persisted name",
        organizationId: fixtures.orgA.id,
        clientId: fixtures.clientA.id,
        frequency: "MONTHLY",
        anchorDay: 1,
        nextIssueDate: new Date(),
        invoiceNumberPrefix: `RESET-EDIT-${Date.now()}-`,
        nextSequence: 1,
        dueDateOffsetDays: 5,
        currency: "USD",
        status: "ACTIVE",
        taxLabel: "TAX",
        discountType: "PERCENTAGE",
        discountValue: "10",
        notes: "Original persisted note",
        internalNotes: "Original persisted internal note",
        lineItems: { create: [{ description: "Retainer", quantity: "1", unitPrice: "10.00", position: 0 }] },
      },
    });
    extraScheduleIds.push(schedule.id);

    await page.goto(`/recurring-invoices/${schedule.id}/edit`);

    // Persisted values render correctly on first load.
    await expect(page.getByLabel("Name")).toHaveValue("Original persisted name");
    await expect(page.getByLabel("Due date offset (days)")).toHaveValue("5");
    await expect(page.getByLabel("Discount type")).toHaveValue("PERCENTAGE");
    await expect(page.getByLabel("Notes", { exact: true })).toHaveValue("Original persisted note");
    await expect(page.getByLabel("Internal notes")).toHaveValue("Original persisted internal note");

    // Edit several of them — including `discountType`, a native
    // <select> that was ALREADY controlled before this corrective pass
    // but still reverted (the deeper DOM-vs-React desync also fixed for
    // `taxLabel`/`frequency`). `frequency` itself is create-only and so
    // has no edit-mode case to cover here.
    await page.getByLabel("Name").fill("Unsaved edited name");
    await page.getByLabel("Due date offset (days)").fill("20");
    await page.getByLabel("Tax label").selectOption("GST");
    await page.getByLabel("Discount type").selectOption("FIXED");
    await page.getByLabel("Discount amount").fill("5.00");
    await page.getByLabel("Notes", { exact: true }).fill("Unsaved edited note");
    await page.getByLabel("Internal notes").fill("Unsaved edited internal note");

    // Trigger an unrelated server validation error.
    await page.getByLabel("Tax rate (%)").fill("150");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Enter a tax rate between 0 and 100.")).toBeVisible();

    // The UNSAVED edits remain visible — not the original persisted
    // values. Reverting to the persisted value would look superficially
    // "valid" (a real stored value, not blank) while still silently
    // discarding the user's in-progress edit — exactly the subtler
    // failure mode this edit-mode case is designed to catch.
    await expect(page.getByLabel("Name")).toHaveValue("Unsaved edited name");
    await expect(page.getByLabel("Due date offset (days)")).toHaveValue("20");
    await expect(page.getByLabel("Tax label")).toHaveValue("GST");
    await expect(page.getByLabel("Discount type")).toHaveValue("FIXED");
    await expect(page.getByLabel("Discount amount")).toHaveValue("5.00");
    await expect(page.getByLabel("Notes", { exact: true })).toHaveValue("Unsaved edited note");
    await expect(page.getByLabel("Internal notes")).toHaveValue("Unsaved edited internal note");

    // The DB record itself is untouched — the save genuinely failed server-side.
    const unchanged = await dbQuery<{
      name: string | null;
      discountType: string;
      dueDateOffsetDays: number | null;
      taxLabel: string;
      notes: string | null;
      internalNotes: string | null;
    }>("recurringInvoice", "findUniqueOrThrow", { where: { id: schedule.id } });
    expect(unchanged.name).toBe("Original persisted name");
    expect(unchanged.dueDateOffsetDays).toBe(5);
    expect(unchanged.taxLabel).toBe("TAX");
    expect(unchanged.discountType).toBe("PERCENTAGE");
    expect(unchanged.notes).toBe("Original persisted note");
    expect(unchanged.internalNotes).toBe("Original persisted internal note");

    assertNoHydrationErrors(tracker.errors());
  });

  test("create: the two other native <select> fields found by the comprehensive field inventory — frequency and discountType — also survive an unrelated validation error, via the same consolidated fix as taxLabel", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    const tracker = trackErrors(page);

    await page.goto("/recurring-invoices/new");
    await selectSearchableOption(page, "Client", fixtures.clientA.name, fixtures.clientA.name);
    await page.getByLabel("First issue date").fill("2027-05-01");
    await page.getByLabel("Invoice number prefix").fill(`RESET-SEL-${fixtures.runId}`);

    const row1 = page.getByRole("group", { name: "Line item 1" });
    await row1.getByLabel("Description").fill("Retainer");
    await row1.getByLabel("Qty").fill("1");
    await row1.getByLabel("Unit price").fill("50.00");

    await page.getByLabel("Frequency").selectOption("WEEKLY");
    await page.getByLabel("Discount type").selectOption("FIXED");
    await page.getByLabel("Discount amount").fill("5.00");

    // The same real, pre-existing server validation rule used by the
    // other tests in this file.
    await page.getByLabel("Tax rate (%)").fill("150");
    await page.getByRole("button", { name: "Create schedule" }).click();
    await expect(page.getByText("Enter a tax rate between 0 and 100.")).toBeVisible();

    // The DOM `<select>` value itself survives (not just React state) —
    // `toHaveValue` on a <select> locator reads the live DOM value.
    await expect(page.getByLabel("Frequency")).toHaveValue("WEEKLY");
    await expect(page.getByLabel("Discount type")).toHaveValue("FIXED");
    // The conditional field remaining present and correct proves React's
    // own `discountType` state was never actually lost — only the
    // `<select>` DOM node's own display had drifted before this fix.
    await expect(page.getByLabel("Discount amount")).toBeVisible();
    await expect(page.getByLabel("Discount amount")).toHaveValue("5.00");

    assertNoHydrationErrors(tracker.errors());
  });

  test("successful resubmission after error: a discount set before an unrelated error is still exactly what gets saved once the error is corrected — not silently discarded by a stale DOM <select> value", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);

    await page.goto("/recurring-invoices/new");
    await selectSearchableOption(page, "Client", fixtures.clientA.name, fixtures.clientA.name);
    await page.getByLabel("First issue date").fill("2027-04-01");
    const prefix = `RESET-RESUB-${fixtures.runId}`;
    await page.getByLabel("Invoice number prefix").fill(prefix);

    const row1 = page.getByRole("group", { name: "Line item 1" });
    await row1.getByLabel("Description").fill("Retainer");
    await row1.getByLabel("Qty").fill("1");
    await row1.getByLabel("Unit price").fill("50.00");

    // Set a discount, then trigger an unrelated error.
    await page.getByLabel("Discount type").selectOption("FIXED");
    await page.getByLabel("Discount amount").fill("5.00");
    await page.getByLabel("Tax rate (%)").fill("150");
    await page.getByRole("button", { name: "Create schedule" }).click();
    await expect(page.getByText("Enter a tax rate between 0 and 100.")).toBeVisible();

    // Still shows FIXED / 5.00 after the failed settlement.
    await expect(page.getByLabel("Discount type")).toHaveValue("FIXED");
    await expect(page.getByLabel("Discount amount")).toHaveValue("5.00");

    // Correct the actual error field and resubmit, WITHOUT touching
    // discountType/discountValue again — if the DOM `<select>` value had
    // silently drifted to "NONE" despite the visible "FIXED", the native
    // FormData submitted here would carry the stale, wrong value.
    await page.getByLabel("Tax rate (%)").fill("8.25");
    await page.getByRole("button", { name: "Create schedule" }).click();
    // A successful create redirects to the new schedule's own detail
    // page (/recurring-invoices/{id}), never the list — and critically
    // never to /recurring-invoices/new, so this genuinely proves the
    // submission left the create form rather than merely staying put.
    await expect(page).toHaveURL(/\/recurring-invoices\/(?!new\b)/);

    const created = await dbQuery<{ discountType: string; discountValue: string | null; taxRatePercent: string | null }>(
      "recurringInvoice",
      "findFirstOrThrow",
      { where: { invoiceNumberPrefix: prefix } },
    );
    extraScheduleIds.push((created as unknown as { id: string }).id ?? "");

    expect(created.discountType).toBe("FIXED");
    expect(Number(created.discountValue)).toBe(5);
    expect(Number(created.taxRatePercent)).toBe(8.25);
  });

  test("create: comprehensive multi-control-type sweep (text, date, number, native select, SearchableSelect, conditional field, textarea, line item) — every edited value survives one unrelated validation error", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    const tracker = trackErrors(page);

    await page.goto("/recurring-invoices/new");

    // SearchableSelect (Client).
    await selectSearchableOption(page, "Client", fixtures.clientA.name, fixtures.clientA.name);
    // text input.
    await page.getByLabel("Name").fill("Sweep schedule name");
    // native <select>.
    await page.getByLabel("Frequency").selectOption("QUARTERLY");
    // date input.
    await page.getByLabel("First issue date").fill("2027-06-15");
    const prefix = `RESET-SWEEP-${fixtures.runId}`;
    await page.getByLabel("Invoice number prefix").fill(prefix);
    // number input.
    await page.getByLabel("Due date offset (days)").fill("12");

    // line item (description/qty/unitPrice).
    const row1 = page.getByRole("group", { name: "Line item 1" });
    await row1.getByLabel("Description").fill("Sweep line item");
    await row1.getByLabel("Qty").fill("2");
    await row1.getByLabel("Unit price").fill("33.00");

    // SearchableSelect (Currency).
    await selectSearchableOption(page, "Currency", "EUR", "EUR");
    // native <select> + its conditional dependent field.
    await page.getByLabel("Discount type").selectOption("PERCENTAGE");
    await page.getByLabel("Discount (%)").fill("10");
    // native <select>.
    await page.getByLabel("Tax label").selectOption("GST");
    // textarea.
    await page.getByLabel("Notes", { exact: true }).fill("Sweep public note");
    await page.getByLabel("Internal notes").fill("Sweep internal note");

    // The same real, pre-existing, unrelated server validation error.
    await page.getByLabel("Tax rate (%)").fill("150");
    await page.getByRole("button", { name: "Create schedule" }).click();
    await expect(page.getByText("Enter a tax rate between 0 and 100.")).toBeVisible();

    await expect(page.getByRole("combobox", { name: "Client" })).toHaveValue(fixtures.clientA.name);
    await expect(page.getByLabel("Name")).toHaveValue("Sweep schedule name");
    await expect(page.getByLabel("Frequency")).toHaveValue("QUARTERLY");
    await expect(page.getByLabel("First issue date")).toHaveValue("2027-06-15");
    await expect(page.getByLabel("Invoice number prefix")).toHaveValue(prefix);
    await expect(page.getByLabel("Due date offset (days)")).toHaveValue("12");
    await expect(row1.getByLabel("Description")).toHaveValue("Sweep line item");
    await expect(row1.getByLabel("Qty")).toHaveValue("2");
    await expect(row1.getByLabel("Unit price")).toHaveValue("33.00");
    await expect(page.getByRole("combobox", { name: "Currency" })).toHaveValue("EUR");
    await expect(page.getByLabel("Discount type")).toHaveValue("PERCENTAGE");
    await expect(page.getByLabel("Discount (%)")).toHaveValue("10");
    await expect(page.getByLabel("Tax label")).toHaveValue("GST");
    await expect(page.getByLabel("Notes", { exact: true })).toHaveValue("Sweep public note");
    await expect(page.getByLabel("Internal notes")).toHaveValue("Sweep internal note");

    assertNoHydrationErrors(tracker.errors());
  });

  test("successful create: controlled values for the formerly-uncontrolled fields are submitted correctly", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);

    await page.goto("/recurring-invoices/new");
    await selectSearchableOption(page, "Client", fixtures.clientA.name, fixtures.clientA.name);
    await page.getByLabel("Name").fill("Successful create name");
    await page.getByLabel("First issue date").fill("2027-03-01");
    const prefix = `RESET-OK-${fixtures.runId}`;
    await page.getByLabel("Invoice number prefix").fill(prefix);
    await page.getByLabel("Due date offset (days)").fill("15");

    const row1 = page.getByRole("group", { name: "Line item 1" });
    await row1.getByLabel("Description").fill("Retainer");
    await row1.getByLabel("Qty").fill("1");
    await row1.getByLabel("Unit price").fill("50.00");

    await page.getByLabel("Tax label").selectOption("VAT");
    await page.getByLabel("Notes", { exact: true }).fill("Submitted public note");
    await page.getByLabel("Internal notes").fill("Submitted internal note");

    await page.getByRole("button", { name: "Create schedule" }).click();
    await expect(page).toHaveURL(/\/recurring-invoices\/(?!new\b)/);

    const created = await dbQuery<{
      name: string | null;
      dueDateOffsetDays: number | null;
      taxLabel: string;
      notes: string | null;
      internalNotes: string | null;
    }>("recurringInvoice", "findFirstOrThrow", { where: { invoiceNumberPrefix: prefix } });
    extraScheduleIds.push((created as unknown as { id: string }).id ?? "");

    expect(created.name).toBe("Successful create name");
    expect(created.dueDateOffsetDays).toBe(15);
    expect(created.taxLabel).toBe("VAT");
    expect(created.notes).toBe("Submitted public note");
    expect(created.internalNotes).toBe("Submitted internal note");
  });

  test("390x900: affected fields remain usable, Client/Project selectors still function, no destructive overflow", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/recurring-invoices/new");

    await selectSearchableOption(page, "Client", fixtures.clientA.name, fixtures.clientA.name);
    await page.getByLabel("Name").fill("Mobile name");
    await page.getByLabel("Notes", { exact: true }).fill("Mobile note");
    await page.getByLabel("Internal notes").fill("Mobile internal note");

    await expect(page.getByLabel("Name")).toHaveValue("Mobile name");
    await expect(page.getByLabel("Notes", { exact: true })).toHaveValue("Mobile note");

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflow).toBe(false);
  });
});
