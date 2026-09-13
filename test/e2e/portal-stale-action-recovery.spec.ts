import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Portal stale Server Action hardening. A stale-deployment Server
 * Action failure (Next.js recognizing that the requested action id no
 * longer exists — see src/lib/action-error.ts's own doc comment for the
 * exact mechanics) must surface as the same inline
 * "This page may be out of date. Refresh and try again." recovery UX
 * Staff forms already get, never an uncaught exception reaching the
 * Portal segment error boundary ("Something went wrong").
 *
 * A genuine two-build deployment skew can't be reproduced without two
 * coexisting Next.js builds. Instead, each test here lets a real click
 * drive the real component and the real bound Server Action reference,
 * then intercepts only the network response for that one POST and
 * substitutes the exact shape Next's own action-handler.js produces for
 * a real unrecognized/stale action id (404, text/plain,
 * x-nextjs-action-not-found: 1, a generic body) — the same technique
 * used to verify the isStaleServerActionError() fix itself. Everything
 * else (the click, the dialog, the form, the bound action reference) is
 * real, unmodified application code.
 */

let fixtures: TestFixtures;

async function actAsPortalUser(context: BrowserContext, baseURL: string): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, { id: fixtures.portalUser.id, email: fixtures.portalUser.email }, baseURL);
}

async function interceptActionPost(page: import("@playwright/test").Page, url: string): Promise<void> {
  await page.route(url, async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      await route.fulfill({
        status: 404,
        headers: {
          "content-type": "text/plain",
          "x-nextjs-action-not-found": "1",
        },
        body: "Server action not found.",
      });
      return;
    }
    await route.continue();
  });
}

test.describe("Portal stale Server Action recovery", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test.beforeEach(async ({ context, baseURL }) => {
    await actAsPortalUser(context, baseURL!);
  });

  test("Quote approve: a stale-action response shows the recovery message, never the error boundary, and the Quote is unchanged", async ({ page, baseURL }) => {
    const quote = await dbQuery<{ id: string }>("quote", "create", {
      data: {
        number: `E2E-STALE-QUOTE-${Date.now()}`,
        status: "SENT",
        sentAt: new Date().toISOString(),
        subtotal: "80.00",
        discountAmount: "0.00",
        taxAmount: "0.00",
        total: "80.00",
        organizationId: fixtures.orgA.id,
        createdByUserId: fixtures.owner.id,
        clientId: fixtures.clientA.id,
        items: { create: [{ description: "Design work", quantity: "2", unitPrice: "40.00", lineTotal: "80.00", position: 0 }] },
      },
    });

    try {
      const url = `/portal/quotes/${quote.id}`;
      await page.goto(url);
      await expect(page.getByRole("button", { name: "Approve quote" })).toBeVisible();

      await interceptActionPost(page, `${baseURL}${url}`);

      await page.getByRole("button", { name: "Approve quote" }).click();
      const dialog = page.locator("dialog[open]");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Approve quote", exact: true }).click();

      // The recovery toast appears...
      await expect(page.getByText("This page may be out of date. Refresh and try again.")).toBeVisible();
      // ...the segment error boundary never takes over the page...
      await expect(page.getByText("Something went wrong")).toHaveCount(0);
      // ...the page itself is still intact (not a crashed/blank takeover)...
      await expect(page.getByRole("button", { name: "Approve quote" })).toBeVisible();
      await expect(page).toHaveURL(url);

      // ...and no automatic retry mutated the Quote.
      const reread = await dbQuery<{ status: string }>("quote", "findUniqueOrThrow", { where: { id: quote.id } });
      expect(reread.status).toBe("SENT");
    } finally {
      await dbQuery("quote", "delete", { where: { id: quote.id } });
    }
  });

  test("Client Request message send: a stale-action response shows the inline recovery message, never the error boundary, and no message is created", async ({ page, baseURL }) => {
    const request = await dbQuery<{ id: string }>("clientRequest", "create", {
      data: {
        organizationId: fixtures.orgA.id,
        clientId: fixtures.clientA.id,
        title: `E2E Stale Action Request ${Date.now()}`,
        description: "Testing stale-action recovery on the message composer.",
      },
    });

    try {
      const url = `/portal/requests/${request.id}`;
      await page.goto(url);
      await expect(page.getByLabel("Add a message")).toBeVisible();

      await interceptActionPost(page, `${baseURL}${url}`);

      await page.getByLabel("Add a message").fill("Should surface a recovery message, not a crash.");
      await page.getByRole("button", { name: "Send" }).click();

      await expect(page.getByText("This page may be out of date. Refresh and try again.")).toBeVisible();
      await expect(page.getByText("Something went wrong")).toHaveCount(0);
      await expect(page.getByLabel("Add a message")).toBeVisible();
      await expect(page).toHaveURL(url);

      const count = await dbQuery<number>("clientRequestMessage", "count", {
        where: { requestId: request.id, body: "Should surface a recovery message, not a crash." },
      });
      expect(count).toBe(0);
    } finally {
      await dbQuery("clientRequestMessage", "deleteMany", { where: { requestId: request.id } });
      await dbQuery("clientRequest", "delete", { where: { id: request.id } });
    }
  });

  test("Client Request create: a stale-action response shows the inline recovery message, never the error boundary, and no request is created", async ({ page, baseURL }) => {
    const url = "/portal/requests/new";
    await page.goto(url);
    await expect(page.getByRole("heading", { name: "New request" })).toBeVisible();

    await interceptActionPost(page, `${baseURL}${url}`);

    const title = `E2E Stale Action Create ${Date.now()}`;
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Description").fill("Testing stale-action recovery on the create form.");
    await page.getByRole("button", { name: "Submit request" }).click();

    await expect(page.getByText("This page may be out of date. Refresh and try again.")).toBeVisible();
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "New request" })).toBeVisible();
    await expect(page).toHaveURL(url);

    const count = await dbQuery<number>("clientRequest", "count", { where: { title } });
    expect(count).toBe(0);
  });

  test("normal validation and success behavior are unaffected by the stale-action wrapper", async ({ page }) => {
    // No interception here — the real action runs for real, proving the
    // wrapper never interferes with an ordinary success or a genuine
    // domain rejection.
    await page.goto("/portal/requests/new");
    await page.getByRole("button", { name: "Submit request" }).click();
    // Native required-field validation blocks submission entirely — the
    // same existing behavior this wrapper must never bypass.
    await expect(page).toHaveURL("/portal/requests/new");

    const title = `E2E Normal Create ${Date.now()}`;
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Description").fill("A perfectly normal request.");
    await page.getByRole("button", { name: "Submit request" }).click();
    await expect(page).toHaveURL(new RegExp("/portal/requests/(?!new$)"));

    await dbQuery("clientRequest", "deleteMany", { where: { title } });
  });
});
