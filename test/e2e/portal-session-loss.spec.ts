import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Portal session-loss UX fix. The Portal session-loss audit found the
 * same class of gap the Staff session-loss fix already addressed: an
 * already-rendered Portal page's next Server Action, on discovering the
 * session is gone, redirected to a bare /portal/login with no reason and
 * no way back. This suite exercises the fix's own contract end to end:
 * the mutation is still blocked, the redirect carries
 * `reason=session_expired` and a safe, Portal-scoped `redirectTo`, the
 * Portal login page explains what happened, and — once
 * re-authenticated — the user returns to the originating Portal route.
 * Domain-layer correctness (Quote decisions, Client Requests) is already
 * covered by portal-quotes.spec.ts and the integration suite; this file
 * only exercises the session-loss path itself, on both the surface that
 * surfaced the audit (Quote approve) and one unrelated Portal action
 * (Client Request message send), to prove the fix is app-wide within
 * Portal rather than Quotes-specific. Portal stale Server Action
 * hardening is a separate, not-yet-implemented follow-up — not
 * exercised here.
 */

let fixtures: TestFixtures;

async function actAsPortalUser(context: BrowserContext, baseURL: string): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, { id: fixtures.portalUser.id, email: fixtures.portalUser.email }, baseURL);
}

/**
 * Drops only the TEST_MODE identity cookie, without reloading the
 * already-rendered page — the exact "session disappeared between render
 * and the next Server Action" shape the read-only audit's own local
 * reproduction established. Portal has no organization-switcher cookie
 * to preserve (unlike Staff), so this is just a plain cookie clear.
 */
async function loseSession(context: BrowserContext): Promise<void> {
  await context.clearCookies();
}

test.describe("Portal session-loss UX", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test.beforeEach(async ({ context, baseURL }) => {
    await actAsPortalUser(context, baseURL!);
  });

  test("Quote approve: a session lost after render redirects to /portal/login with reason+redirectTo, blocks the mutation, and returns to the Quote route after re-auth", async ({
    page,
    context,
    baseURL,
  }) => {
    const quote = await dbQuery<{ id: string }>("quote", "create", {
      data: {
        number: `E2E-PSL-${Date.now()}`,
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
      await page.goto(`/portal/quotes/${quote.id}`);
      await expect(page.getByRole("button", { name: "Approve quote" })).toBeVisible();

      await loseSession(context);

      await page.getByRole("button", { name: "Approve quote" }).click();
      const dialog = page.locator("dialog[open]");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Approve quote", exact: true }).click();

      await expect(page).toHaveURL(/\/portal\/login\?/);
      const loginUrl = new URL(page.url());
      expect(loginUrl.searchParams.get("reason")).toBe("session_expired");
      expect(loginUrl.searchParams.get("redirectTo")).toBe(`/portal/quotes/${quote.id}`);
      await expect(page.getByText("Your session expired. Sign in again to continue.")).toBeVisible();

      // The mutation did not happen — auth resolution runs before the
      // quote's status transition is ever attempted.
      const reread = await dbQuery<{ status: string }>("quote", "findUniqueOrThrow", { where: { id: quote.id } });
      expect(reread.status).toBe("SENT");

      // TEST_MODE has no real signInWithPassword to submit — re-
      // authenticating is simulated the same way every other E2E test in
      // this repo establishes a session, by injecting the identity
      // cookie directly. Revisiting the exact URL just landed on then
      // exercises the real, pre-existing "/portal/login already-
      // authenticated" branch, which performs the actual
      // return-to-origin redirect.
      await injectTestSession(context, { id: fixtures.portalUser.id, email: fixtures.portalUser.email }, baseURL!);
      await page.goto(page.url());
      await expect(page).toHaveURL(`/portal/quotes/${quote.id}`);
    } finally {
      await dbQuery("quote", "delete", { where: { id: quote.id } });
    }
  });

  test("Client Request message send (existing, non-Quote Portal action): the same session-loss behavior — redirect, reason, redirectTo, no mutation", async ({
    page,
    context,
  }) => {
    const request = await dbQuery<{ id: string; title: string }>("clientRequest", "create", {
      data: {
        organizationId: fixtures.orgA.id,
        clientId: fixtures.clientA.id,
        title: `E2E Session Loss Request ${Date.now()}`,
        description: "Testing session loss on the message composer.",
      },
    });

    try {
      await page.goto(`/portal/requests/${request.id}`);
      await expect(page.getByLabel("Add a message")).toBeVisible();

      await loseSession(context);

      await page.getByLabel("Add a message").fill("Should never be saved.");
      await page.getByRole("button", { name: "Send" }).click();

      await expect(page).toHaveURL(/\/portal\/login\?/);
      const loginUrl = new URL(page.url());
      expect(loginUrl.searchParams.get("reason")).toBe("session_expired");
      expect(loginUrl.searchParams.get("redirectTo")).toBe(`/portal/requests/${request.id}`);
      await expect(page.getByText("Your session expired. Sign in again to continue.")).toBeVisible();

      const count = await dbQuery<number>("clientRequestMessage", "count", {
        where: { requestId: request.id, body: "Should never be saved." },
      });
      expect(count).toBe(0);
    } finally {
      await dbQuery("clientRequestMessage", "deleteMany", { where: { requestId: request.id } });
      await dbQuery("clientRequest", "delete", { where: { id: request.id } });
    }
  });

  test("ordinary /portal/login visit shows no session-expired message, and successful login still uses the existing default destination", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/portal/login");
    await expect(page.getByRole("heading", { name: "Client Portal" })).toBeVisible();
    await expect(page.getByText("Your session expired.")).toHaveCount(0);
    // No redirectTo was supplied — sanitizePortalRedirectPath()'s own
    // existing default landing route applies unchanged.
    await expect(page.locator('input[name="redirectTo"]')).toHaveValue("/portal");
  });

  test("security: a malicious redirectTo can never escape /portal", async ({ page, context }) => {
    await context.clearCookies();

    await page.goto(`/portal/login?redirectTo=${encodeURIComponent("https://evil.example")}`);
    await expect(page.locator('input[name="redirectTo"]')).toHaveValue("/portal");

    await page.goto(`/portal/login?redirectTo=${encodeURIComponent("//evil.example")}`);
    await expect(page.locator('input[name="redirectTo"]')).toHaveValue("/portal");

    // A Staff route is a valid same-origin path, but must never flow
    // through as a Portal redirectTo either.
    await page.goto(`/portal/login?redirectTo=${encodeURIComponent("/dashboard")}`);
    await expect(page.locator('input[name="redirectTo"]')).toHaveValue("/portal");

    await page.goto(`/portal/login?redirectTo=${encodeURIComponent("/platform-admin")}`);
    await expect(page.locator('input[name="redirectTo"]')).toHaveValue("/portal");
  });
});
