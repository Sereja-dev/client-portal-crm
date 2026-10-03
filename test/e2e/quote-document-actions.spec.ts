import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Finance Document Actions — Quote Duplicate + Quote PDF. Real browser
 * coverage for the behavior that genuinely needs one: the Duplicate
 * link's discoverability and prefill, that opening it mutates nothing,
 * that submitting it creates a real new DRAFT and leaves the source
 * untouched, the Download PDF link's discoverability/href, and the
 * 390x900 responsive layout of both new actions alongside the existing
 * lifecycle controls. Backend copy/reset semantics and PDF content are
 * already exhaustively covered by test/integration/quotes/duplicate.test.ts
 * and test/integration/quotes/pdf.test.ts — not re-derived here.
 */

let fixtures: TestFixtures;
let extraQuoteIds: string[] = [];

async function actAs(context: BrowserContext, baseURL: string, identity: { id: string; email: string }, organizationId: string): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, identity, baseURL);
  await context.addCookies([
    { name: "active_organization_id", value: organizationId, domain: new URL(baseURL).hostname, path: "/", httpOnly: true, secure: false, sameSite: "Lax" },
  ]);
}

test.describe("Quote Document Actions — Duplicate + PDF", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterEach(async () => {
    if (extraQuoteIds.length > 0) {
      await dbQuery("quote", "deleteMany", { where: { id: { in: extraQuoteIds } } });
      extraQuoteIds = [];
    }
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test("Duplicate: discoverable from the Quote edit page, opening it mutates nothing, fields are prefilled, submitting creates a new DRAFT and leaves the source unchanged", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);

    const sourceNumber = `E2E-QDUP-${fixtures.runId}`;
    const source = await dbQuery<{ id: string; updatedAt: string }>("quote", "create", {
      data: {
        number: sourceNumber,
        status: "SENT",
        sentAt: new Date().toISOString(),
        recipientName: "Original Recipient",
        recipientEmail: "original@example.test",
        subtotal: "100.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        total: "100.00",
        currency: "EUR",
        notes: "Original notes",
        organizationId: fixtures.orgA.id,
        createdByUserId: fixtures.owner.id,
        clientId: fixtures.clientA.id,
        items: { create: [{ description: "Original line item", quantity: "2", unitPrice: "50.00", lineTotal: "100.00", position: 0 }] },
      },
    });

    await page.goto(`/quotes/${source.id}/edit`);
    const duplicateLink = page.getByRole("link", { name: "Duplicate as new draft" });
    await expect(duplicateLink).toBeVisible();

    // Opening the Duplicate page itself performs zero mutation.
    const sourceBeforeOpen = await dbQuery<{ updatedAt: string }>("quote", "findUniqueOrThrow", { where: { id: source.id } });
    await duplicateLink.click();
    await expect(page).toHaveURL(new RegExp(`/quotes/${source.id}/duplicate$`));
    const sourceAfterOpen = await dbQuery<{ updatedAt: string }>("quote", "findUniqueOrThrow", { where: { id: source.id } });
    expect(sourceAfterOpen).toEqual(sourceBeforeOpen);

    // Prefilled: currency, item description, notes all visible before any submit.
    await expect(page.getByLabel("Currency")).toHaveValue("EUR");
    await expect(page.getByRole("group", { name: "Line item 1" }).getByLabel("Description")).toHaveValue("Original line item");
    await expect(page.getByLabel("Notes")).toHaveValue("Original notes");
    // The suggested number is a fresh one, never the source's own number.
    await expect(page.getByLabel("Quote number")).not.toHaveValue(sourceNumber);

    await Promise.all([
      page.waitForURL(/\/quotes(\?|$)/),
      page.getByRole("button", { name: "Create duplicate" }).click(),
    ]);
    await expect(page.getByText("Quote created")).toBeVisible();

    const created = await dbQuery<{ id: string; status: string; number: string }[]>("quote", "findMany", {
      where: { organizationId: fixtures.orgA.id, number: { not: sourceNumber }, clientId: fixtures.clientA.id, currency: "EUR", notes: "Original notes" },
    });
    expect(created.length).toBeGreaterThanOrEqual(1);
    const duplicate = created[created.length - 1];
    expect(duplicate.status).toBe("DRAFT");
    extraQuoteIds = [duplicate.id];

    // Source unchanged.
    const sourceAfterSubmit = await dbQuery<{ status: string; number: string; sentAt: string | null }>("quote", "findUniqueOrThrow", {
      where: { id: source.id },
    });
    expect(sourceAfterSubmit.status).toBe("SENT");
    expect(sourceAfterSubmit.number).toBe(sourceNumber);
    expect(sourceAfterSubmit.sentAt).not.toBeNull();

    extraQuoteIds.push(source.id);
  });

  test("Download PDF: discoverable, correct href, route responds with a real PDF, no navigation/runtime break", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);

    const number = `E2E-QPDF-${fixtures.runId}`;
    const quote = await dbQuery<{ id: string }>("quote", "create", {
      data: {
        number,
        status: "DRAFT",
        subtotal: "50.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        total: "50.00",
        currency: "USD",
        organizationId: fixtures.orgA.id,
        createdByUserId: fixtures.owner.id,
        clientId: fixtures.clientA.id,
        items: { create: [{ description: "Line item", quantity: "1", unitPrice: "50.00", lineTotal: "50.00", position: 0 }] },
      },
    });
    extraQuoteIds = [quote.id];

    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto(`/quotes/${quote.id}/edit`);
    const downloadLink = page.getByRole("link", { name: "Download PDF" });
    await expect(downloadLink).toBeVisible();
    const href = await downloadLink.getAttribute("href");
    expect(href).toBe(`/api/quotes/${quote.id}/pdf`);

    const fileResponse = await page.request.get(href!);
    expect(fileResponse.ok()).toBe(true);
    expect(fileResponse.headers()["content-type"]).toBe("application/pdf");
    const body = await fileResponse.body();
    expect(body.subarray(0, 4).toString("latin1")).toBe("%PDF");

    expect(errors).toEqual([]);
  });

  test("390x900: Duplicate and Download PDF remain usable alongside existing lifecycle actions, no page-level horizontal overflow", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);

    const number = `E2E-QRESP-${fixtures.runId}`;
    const quote = await dbQuery<{ id: string }>("quote", "create", {
      data: {
        number,
        status: "APPROVED",
        approvedAt: new Date().toISOString(),
        subtotal: "50.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        total: "50.00",
        currency: "USD",
        organizationId: fixtures.orgA.id,
        createdByUserId: fixtures.owner.id,
        clientId: fixtures.clientA.id,
        items: { create: [{ description: "Line item", quantity: "1", unitPrice: "50.00", lineTotal: "50.00", position: 0 }] },
      },
    });
    extraQuoteIds = [quote.id];

    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/quotes/${quote.id}/edit`);

    await expect(page.getByRole("link", { name: "Duplicate as new draft" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Download PDF" })).toBeVisible();
    // APPROVED + a real Client -> Convert to invoice is also offered here; proves the new actions don't crowd out or hide existing lifecycle controls.
    await expect(page.getByRole("button", { name: "Convert to invoice" })).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);
  });
});
