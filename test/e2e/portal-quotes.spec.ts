import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Aqenra Quotes Phase 4 — Client Portal approval/decline. Real browser
 * coverage for the Portal Quote list/detail rendering, the Approve/
 * Decline confirmation flow, DRAFT/cross-client denial, the Converted ->
 * Portal Invoice link, and the Staff-side refresh after a Portal
 * decision. Backend rules (race safety, eligibility, Activity) are
 * already covered by test/integration/quotes/portal-decision.test.ts and
 * are not re-derived here.
 */

async function actAsPortalUser(context: BrowserContext, baseURL: string, portalUser: { id: string; email: string }): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, portalUser, baseURL);
}

async function actAsStaff(context: BrowserContext, baseURL: string, user: { id: string; email: string }): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, user, baseURL);
}

let fixtures: TestFixtures;

test.beforeAll(async () => {
  fixtures = await seedE2EFixtures();
});

test.afterAll(async () => {
  await cleanupTestData(fixtures);
});

async function seedQuote(overrides: Record<string, unknown>) {
  return dbQuery<{ id: string; number: string }>("quote", "create", {
    data: {
      number: `E2E-PQ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      status: "DRAFT",
      subtotal: "80.00",
      discountAmount: "0.00",
      taxAmount: "0.00",
      total: "80.00",
      organizationId: fixtures.orgA.id,
      createdByUserId: fixtures.owner.id,
      clientId: fixtures.clientA.id,
      items: { create: [{ description: "Design work", quantity: "2", unitPrice: "40.00", lineTotal: "80.00", position: 0 }] },
      ...overrides,
    },
  });
}

test.describe("Portal Quotes list & detail", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await actAsPortalUser(context, baseURL!, { id: fixtures.portalUser.id, email: fixtures.portalUser.email });
  });

  test("11. own SENT quote is listed and opens, showing line items and totals", async ({ page }) => {
    const quote = await seedQuote({ status: "SENT", sentAt: new Date().toISOString() });
    try {
      await page.goto("/portal/quotes");
      await expect(page.getByRole("link", { name: quote.number })).toBeVisible();

      await page.getByRole("link", { name: quote.number }).click();
      await expect(page).toHaveURL(new RegExp(`/portal/quotes/${quote.id}$`));
      await expect(page.getByText("Design work")).toBeVisible();
      await expect(page.getByText("$80.00").first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Approve quote" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Decline quote" })).toBeVisible();
    } finally {
      await dbQuery("quote", "deleteMany", { where: { id: quote.id } });
    }
  });

  test("14. a DRAFT quote's direct URL is blocked with the same generic not-found used elsewhere in the Portal", async ({ page }) => {
    const quote = await seedQuote({ status: "DRAFT" });
    try {
      await page.goto(`/portal/quotes/${quote.id}`);
      await expect(page.getByText("Page not found")).toBeVisible();
    } finally {
      await dbQuery("quote", "deleteMany", { where: { id: quote.id } });
    }
  });

  test("6/15. DRAFT and archived quotes never appear in the Portal list", async ({ page }) => {
    const draft = await seedQuote({ status: "DRAFT" });
    const archived = await seedQuote({ status: "SENT", sentAt: new Date().toISOString(), archivedAt: new Date().toISOString() });
    try {
      await page.goto("/portal/quotes");
      await expect(page.getByRole("link", { name: draft.number })).toHaveCount(0);
      await expect(page.getByRole("link", { name: archived.number })).toHaveCount(0);
    } finally {
      await dbQuery("quote", "deleteMany", { where: { id: { in: [draft.id, archived.id] } } });
    }
  });

  test("12. a foreign Client's Quote (same org) 404s for this Portal identity", async ({ page }) => {
    const otherClient = await dbQuery<{ id: string }>("client", "create", {
      data: { name: `E2E PQ Other Client ${fixtures.runId}`, organizationId: fixtures.orgA.id, userId: fixtures.owner.id },
    });
    const quote = await seedQuote({ status: "SENT", sentAt: new Date().toISOString(), clientId: otherClient.id });
    try {
      await page.goto(`/portal/quotes/${quote.id}`);
      await expect(page.getByText("Page not found")).toBeVisible();
    } finally {
      await dbQuery("quote", "deleteMany", { where: { id: quote.id } });
      await dbQuery("client", "deleteMany", { where: { id: otherClient.id } });
    }
  });
});

test.describe("Approve / decline", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await actAsPortalUser(context, baseURL!, { id: fixtures.portalUser.id, email: fixtures.portalUser.email });
  });

  test("Approve requires confirmation naming the amount, never implies an invoice or payment, and results in Approved with no more decision buttons", async ({ page }) => {
    const quote = await seedQuote({ status: "SENT", sentAt: new Date().toISOString() });
    try {
      await page.goto(`/portal/quotes/${quote.id}`);
      await page.getByRole("button", { name: "Approve quote" }).click();

      await expect(page.getByText(quote.number).first()).toBeVisible();
      await expect(page.getByText("$80.00").first()).toBeVisible();
      await expect(page.getByText(/does not create an invoice or process any payment/i)).toBeVisible();

      await page.getByRole("button", { name: "Approve quote", exact: true }).nth(1).click();
      await expect(page.getByText("Quote approved")).toBeVisible();
      await expect(page.getByText("Approved", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Approve quote" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Decline quote" })).toHaveCount(0);
    } finally {
      await dbQuery("quote", "deleteMany", { where: { id: quote.id } });
    }
  });

  test("Decline requires confirmation, never asks for a reason, and results in Declined with an explanatory note", async ({ page }) => {
    const quote = await seedQuote({ status: "SENT", sentAt: new Date().toISOString() });
    try {
      await page.goto(`/portal/quotes/${quote.id}`);
      await page.getByRole("button", { name: "Decline quote" }).click();

      // No reason field of any kind is ever rendered.
      await expect(page.getByRole("textbox")).toHaveCount(0);

      await page.getByRole("button", { name: "Decline quote", exact: true }).nth(1).click();
      await expect(page.getByText("Quote declined")).toBeVisible();
      await expect(page.getByText("Declined", { exact: true })).toBeVisible();
      await expect(page.getByText(/business may revise and resend/i)).toBeVisible();
      await expect(page.getByRole("button", { name: "Approve quote" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Decline quote" })).toHaveCount(0);
    } finally {
      await dbQuery("quote", "deleteMany", { where: { id: quote.id } });
    }
  });

  test("an expired SENT quote shows Expired and no decision buttons", async ({ page }) => {
    const quote = await seedQuote({ status: "SENT", sentAt: new Date().toISOString(), validUntil: "2020-01-01T00:00:00.000Z" });
    try {
      await page.goto(`/portal/quotes/${quote.id}`);
      await expect(page.getByText("Expired", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Approve quote" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Decline quote" })).toHaveCount(0);
    } finally {
      await dbQuery("quote", "deleteMany", { where: { id: quote.id } });
    }
  });
});

test.describe("Converted quote", () => {
  test("39/40/41. a converted quote shows Converted and a View invoice link to the canonical Portal Invoice route", async ({ context, baseURL, page }) => {
    await actAsPortalUser(context, baseURL!, { id: fixtures.portalUser.id, email: fixtures.portalUser.email });

    const invoice = await dbQuery<{ id: string; invoiceNumber: string }>("invoice", "create", {
      data: {
        invoiceNumber: `E2E-PQ-CONV-INV-${fixtures.runId}`,
        status: "SENT",
        amount: "80.00",
        subtotal: "80.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        clientId: fixtures.clientA.id,
        organizationId: fixtures.orgA.id,
        issueDate: new Date().toISOString(),
      },
    });
    const quote = await seedQuote({ status: "APPROVED", approvedAt: new Date().toISOString(), convertedInvoiceId: invoice.id });

    try {
      await page.goto(`/portal/quotes/${quote.id}`);
      await expect(page.getByText("Converted", { exact: true })).toBeVisible();
      const invoiceLink = page.getByRole("link", { name: invoice.invoiceNumber });
      await expect(invoiceLink).toBeVisible();
      await expect(invoiceLink).toHaveAttribute("href", `/portal/invoices/${invoice.id}`);

      await invoiceLink.click();
      await expect(page).toHaveURL(new RegExp(`/portal/invoices/${invoice.id}$`));
    } finally {
      await dbQuery("quote", "deleteMany", { where: { id: quote.id } });
      await dbQuery("invoice", "deleteMany", { where: { id: invoice.id } });
    }
  });
});

test.describe("Staff refresh after Portal decision", () => {
  test("35/36. after a Portal approve, the Staff Quote page shows Approved and Convert to invoice", async ({ context, baseURL, page }) => {
    const quote = await seedQuote({ status: "SENT", sentAt: new Date().toISOString() });
    try {
      await actAsPortalUser(context, baseURL!, { id: fixtures.portalUser.id, email: fixtures.portalUser.email });
      await page.goto(`/portal/quotes/${quote.id}`);
      await page.getByRole("button", { name: "Approve quote" }).click();
      await page.getByRole("button", { name: "Approve quote", exact: true }).nth(1).click();
      await expect(page.getByText("Quote approved")).toBeVisible();

      await actAsStaff(context, baseURL!, { id: fixtures.owner.id, email: fixtures.owner.email });
      await page.goto(`/quotes/${quote.id}/edit`);
      await expect(page.getByText("Approved", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Convert to invoice" })).toBeVisible();
    } finally {
      await dbQuery("quote", "deleteMany", { where: { id: quote.id } });
    }
  });

  test("37/38. after a Portal decline, the Staff Quote page shows Declined and Reopen quote", async ({ context, baseURL, page }) => {
    const quote = await seedQuote({ status: "SENT", sentAt: new Date().toISOString() });
    try {
      await actAsPortalUser(context, baseURL!, { id: fixtures.portalUser.id, email: fixtures.portalUser.email });
      await page.goto(`/portal/quotes/${quote.id}`);
      await page.getByRole("button", { name: "Decline quote" }).click();
      await page.getByRole("button", { name: "Decline quote", exact: true }).nth(1).click();
      await expect(page.getByText("Quote declined")).toBeVisible();

      await actAsStaff(context, baseURL!, { id: fixtures.owner.id, email: fixtures.owner.email });
      await page.goto(`/quotes/${quote.id}/edit`);
      await expect(page.getByText("Declined", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Reopen quote" })).toBeVisible();
    } finally {
      await dbQuery("quote", "deleteMany", { where: { id: quote.id } });
    }
  });
});

test.describe("Security", () => {
  test("44. a Portal identity is redirected away from the Staff /quotes UI", async ({ context, baseURL, page }) => {
    await actAsPortalUser(context, baseURL!, { id: fixtures.portalUser.id, email: fixtures.portalUser.email });
    await page.goto("/quotes");
    await expect(page).toHaveURL(/\/portal/);
  });

  test("42. the Portal Quote detail page never renders a Staff /clients, /leads, or /quotes link", async ({ context, baseURL, page }) => {
    await actAsPortalUser(context, baseURL!, { id: fixtures.portalUser.id, email: fixtures.portalUser.email });
    const quote = await seedQuote({ status: "SENT", sentAt: new Date().toISOString() });
    try {
      await page.goto(`/portal/quotes/${quote.id}`);
      await expect(page.locator('a[href^="/clients/"]')).toHaveCount(0);
      await expect(page.locator('a[href^="/leads/"]')).toHaveCount(0);
      await expect(page.locator('a[href^="/quotes/"]')).toHaveCount(0);
      await expect(page.locator('a[href^="/invoices/"]')).toHaveCount(0);
    } finally {
      await dbQuery("quote", "deleteMany", { where: { id: quote.id } });
    }
  });
});
