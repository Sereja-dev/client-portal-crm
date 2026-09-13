import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Staff session-loss UX fix. Communication Timeline's own Production
 * smoke surfaced a general Staff session problem: an already-rendered
 * page's next Server Action redirected to a bare /login with no
 * indication why and no way back to the page the user was on. This
 * suite exercises the fix's own contract end to end: the mutation is
 * still blocked, the redirect carries `reason=session_expired` and a
 * safe `redirectTo`, the login page explains what happened, and — once
 * re-authenticated — the user returns to the originating Staff route.
 * Domain-layer correctness (Timeline notes, Company profile) is already
 * exhaustively covered by timeline.spec.ts / the integration suite;
 * this file only exercises the session-loss path itself, on both the
 * feature that surfaced the bug (Timeline) and one unrelated,
 * pre-existing Server Action (Company profile save), to prove the fix
 * is app-wide rather than Timeline-specific.
 */

let fixtures: TestFixtures;

async function actAsOwner(context: BrowserContext, baseURL: string): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, fixtures.owner, baseURL);
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

/**
 * Drops only the TEST_MODE identity cookie, without reloading the
 * already-rendered page — the exact "session disappeared between render
 * and the next Server Action" shape both the Production incident and the
 * read-only audit's own local reproduction established.
 */
async function loseSessionKeepingOrg(context: BrowserContext, baseURL: string): Promise<void> {
  await context.clearCookies();
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

test.describe("Staff session-loss UX", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test.beforeEach(async ({ context, baseURL }) => {
    await actAsOwner(context, baseURL!);
  });

  test.afterEach(async () => {
    await dbQuery("timelineNote", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
  });

  test("Timeline Add Note: a session lost after render redirects to /login with reason+redirectTo, blocks the mutation, and returns to the Client edit route after re-auth", async ({
    page,
    context,
    baseURL,
  }) => {
    await page.goto(`/clients/${fixtures.clientA.id}/edit`);
    await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();

    await loseSessionKeepingOrg(context, baseURL!);

    await page.getByLabel("Note", { exact: true }).fill("Should never be saved.");
    await page.getByRole("button", { name: "Add note" }).click();

    await expect(page).toHaveURL(/\/login\?/);
    const loginUrl = new URL(page.url());
    expect(loginUrl.searchParams.get("reason")).toBe("session_expired");
    expect(loginUrl.searchParams.get("redirectTo")).toBe(`/clients/${fixtures.clientA.id}/edit`);
    await expect(page.getByText("Your session expired. Sign in again to continue.")).toBeVisible();

    // The mutation did not happen — auth resolution runs before
    // createTimelineNote() is ever called.
    const count = await dbQuery<number>("timelineNote", "count", {
      where: { organizationId: fixtures.orgA.id, entityId: fixtures.clientA.id, body: "Should never be saved." },
    });
    expect(count).toBe(0);

    // TEST_MODE has no real signInWithPassword to submit (see this app's
    // own createTestModeClient() doc comment) — re-authenticating is
    // simulated the same way every other E2E test in this repo
    // establishes a session, by injecting the identity cookie directly.
    // Revisiting the exact URL just landed on then exercises the real,
    // pre-existing "/login already-authenticated" branch, which performs
    // the actual return-to-origin redirect.
    await injectTestSession(context, fixtures.owner, baseURL!);
    await page.goto(page.url());
    await expect(page).toHaveURL(`/clients/${fixtures.clientA.id}/edit`);
  });

  test("Company profile save (existing, non-Timeline Server Action): the same session-loss behavior — redirect, reason, redirectTo, no Dashboard fallback", async ({
    page,
    context,
    baseURL,
  }) => {
    await page.goto("/settings/company");
    await expect(page.getByLabel("Display / company name")).toBeVisible();

    await loseSessionKeepingOrg(context, baseURL!);

    // Fill every required field — same set dashboard-navigation-hardening.
    // spec.ts's own "Company profile save" test already fills — so the
    // form's own client-side required-field validation doesn't block
    // submission before the Server Action (and its session check) ever runs.
    await page.getByLabel("Display / company name").fill("Session Loss Co");
    await page.getByLabel("Legal company name").fill("Session Loss Co LLC");
    await page.getByLabel("Currency").selectOption("USD");
    await page.getByLabel("Time zone").selectOption({ index: 1 });
    await page.getByLabel("Country").fill("US");
    await page.getByRole("button", { name: "Save company profile" }).click();

    await expect(page).toHaveURL(/\/login\?/);
    const loginUrl = new URL(page.url());
    expect(loginUrl.searchParams.get("reason")).toBe("session_expired");
    expect(loginUrl.searchParams.get("redirectTo")).toBe("/settings/company");
    expect(loginUrl.pathname).not.toBe("/dashboard");
    await expect(page.getByText("Your session expired. Sign in again to continue.")).toBeVisible();
  });

  test("ordinary /login visit shows no session-expired message, and successful login still uses the existing default destination", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByText("Your session expired.")).toHaveCount(0);
    // No redirectTo was supplied — sanitizeRedirectPath()'s own existing
    // default landing route applies unchanged.
    await expect(page.locator('input[name="redirectTo"]')).toHaveValue("/dashboard");
  });

  test("security: a malicious redirectTo can never cause external navigation", async ({ page, context }) => {
    await context.clearCookies();

    await page.goto(`/login?redirectTo=${encodeURIComponent("https://evil.example")}`);
    await expect(page.locator('input[name="redirectTo"]')).toHaveValue("/dashboard");

    await page.goto(`/login?redirectTo=${encodeURIComponent("//evil.example")}`);
    await expect(page.locator('input[name="redirectTo"]')).toHaveValue("/dashboard");
  });
});
