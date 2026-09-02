import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Staff AI Assistant drawer/UI batch — real-browser coverage for what
 * unit tests structurally cannot exercise (no DOM/component-interaction
 * harness in this repo — see test/unit/ai/ai-assistant-panel.test.tsx's
 * own header comment): the native `<dialog>`'s own open/close/focus
 * behavior, live fetching against the real (TEST_MODE-backed) route,
 * keyboard interaction, and Portal/Platform Admin absence as experienced
 * through the actual rendered app. Every backend edge case (auth
 * boundary, tool loop, ceilings, timeouts, fail-closed behavior) is
 * already exhaustively covered by the merged orchestration + Route
 * Handler batch's own test suites — this file deliberately does not
 * repeat them, only what genuinely requires a real browser.
 *
 * TEST_MODE is always "1" for this whole E2E run (playwright.config.ts's
 * own webServer.env) — which is exactly what makes
 * isAiAssistantAvailable() resolve true and the trigger render enabled
 * at all. The non-TEST_MODE/Production-unavailable UI state is proven
 * separately, at the render/source level (see
 * test/unit/ai/ai-assistant-trigger.test.tsx's own `available={false}`
 * coverage) — never via an actual Production deployment.
 */

async function setActiveOrg(context: BrowserContext, baseURL: string, organizationId: string): Promise<void> {
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

async function actAsStaff(context: BrowserContext, baseURL: string, user: { id: string; email: string }, organizationId: string): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, user, baseURL);
  await setActiveOrg(context, baseURL, organizationId);
}

function trigger(page: Page) {
  return page.getByRole("button", { name: "AI Assistant", exact: true });
}

function panel(page: Page) {
  return page.getByRole("dialog", { name: "AI Assistant" });
}

function composer(page: Page) {
  return panel(page).getByPlaceholder("Ask a question…");
}

async function openPanel(page: Page): Promise<void> {
  await trigger(page).click();
  await expect(composer(page)).toBeFocused();
}

let fixtures: TestFixtures;

test.beforeAll(async () => {
  fixtures = await seedE2EFixtures();
});

test.afterAll(async () => {
  await cleanupTestData(fixtures);
});

test.describe("desktop", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await actAsStaff(context, baseURL!, fixtures.owner, fixtures.orgA.id);
  });

  test("trigger is visible and enabled for staff, distinct from Search", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(trigger(page)).toBeVisible();
    await expect(trigger(page)).toBeEnabled();
    await expect(page.getByRole("button", { name: "Search (Cmd+K)" })).toBeVisible();
  });

  test("opens the panel, focuses the composer, submits a question, and shows the deterministic mock answer atomically (no fake streaming)", async ({ page }) => {
    await page.goto("/dashboard");
    await openPanel(page);

    await composer(page).fill("How many clients do we have?");
    await composer(page).press("Enter");

    await expect(panel(page).getByText("Thinking…")).toBeVisible();
    await expect(panel(page).getByText("This is a mock AI Assistant response for automated testing.")).toBeVisible();
    // The question itself is also shown, locked, above the answer.
    await expect(panel(page).getByText("How many clients do we have?")).toBeVisible();
    // No composer while an answer is showing — this is a one-question,
    // one-answer card, not a growing transcript.
    await expect(composer(page)).toHaveCount(0);
  });

  test("Shift+Enter inserts a newline instead of submitting", async ({ page }) => {
    await page.goto("/dashboard");
    await openPanel(page);
    await composer(page).fill("first line");
    await composer(page).press("Shift+Enter");
    await composer(page).pressSequentially("second line");
    // Still on the composer — Shift+Enter never submitted.
    await expect(composer(page)).toBeVisible();
    await expect(composer(page)).toHaveValue("first line\nsecond line");
  });

  test("'Ask another question' clears the prior turn and returns to a fresh empty composer — no transcript/history illusion", async ({ page }) => {
    await page.goto("/dashboard");
    await openPanel(page);
    await composer(page).fill("first question");
    await composer(page).press("Enter");
    await expect(panel(page).getByText("This is a mock AI Assistant response for automated testing.")).toBeVisible();

    await panel(page).getByRole("button", { name: "Ask another question" }).click();

    await expect(composer(page)).toBeVisible();
    await expect(composer(page)).toHaveValue("");
    await expect(panel(page).getByText("first question")).toHaveCount(0);
  });

  test("closing and reopening always shows a fresh composer — no local persistence of the prior turn", async ({ page }) => {
    await page.goto("/dashboard");
    await openPanel(page);
    await composer(page).fill("a question that should not survive a close");
    await composer(page).press("Enter");
    await expect(panel(page).getByText("This is a mock AI Assistant response for automated testing.")).toBeVisible();

    await panel(page).getByRole("button", { name: "Close AI Assistant" }).click();
    await expect(panel(page)).toHaveCount(0);

    await openPanel(page);
    await expect(composer(page)).toHaveValue("");
    await expect(panel(page).getByText("a question that should not survive a close")).toHaveCount(0);
  });

  test("Escape closes the panel and focus returns to the trigger", async ({ page }) => {
    await page.goto("/dashboard");
    await openPanel(page);
    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveCount(0);
    await expect(trigger(page)).toBeFocused();
  });

  test("suggested prompts fill the composer without auto-submitting", async ({ page }) => {
    await page.goto("/dashboard");
    await openPanel(page);
    await panel(page).getByRole("button", { name: "Which clients were added recently?" }).click();
    await expect(composer(page)).toHaveValue("Which clients were added recently?");
    // Still idle — clicking a suggestion never submits on its own.
    await expect(composer(page)).toBeVisible();
  });

  test("Copy places the answer on the clipboard and shows transient 'Copied' feedback", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/dashboard");
    await openPanel(page);
    await composer(page).fill("copy this");
    await composer(page).press("Enter");
    await expect(panel(page).getByText("This is a mock AI Assistant response for automated testing.")).toBeVisible();

    await panel(page).getByRole("button", { name: "Copy" }).click();
    await expect(panel(page).getByRole("button", { name: "Copied" })).toBeVisible();

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toBe("This is a mock AI Assistant response for automated testing.");
  });

  test("request contract: the POST body is exactly { message } — no history/organizationId/provider/mockScenario", async ({ page }) => {
    let observedBody: unknown;
    await page.route("**/api/ai/assistant", async (route) => {
      observedBody = route.request().postDataJSON();
      await route.continue();
    });

    await page.goto("/dashboard");
    await openPanel(page);
    await composer(page).fill("contract check");
    await composer(page).press("Enter");
    await expect(panel(page).getByText("This is a mock AI Assistant response for automated testing.")).toBeVisible();

    expect(observedBody).toEqual({ message: "contract check" });
    expect(Object.keys(observedBody as object)).toEqual(["message"]);
  });

  test("closing the panel mid-request aborts it silently — no error is ever rendered for a deliberate cancellation", async ({ page }) => {
    await page.route("**/api/ai/assistant", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await route.continue();
    });

    await page.goto("/dashboard");
    await openPanel(page);
    await composer(page).fill("slow question");
    await composer(page).press("Enter");
    await expect(panel(page).getByText("Thinking…")).toBeVisible();

    await panel(page).getByRole("button", { name: "Close AI Assistant" }).click();
    await expect(panel(page)).toHaveCount(0);

    // Reopening must show a clean idle state — no leftover error from the
    // aborted request. Scoped to the panel itself (not the whole page) —
    // an unrelated part of the dashboard may have its own, unrelated
    // role="alert" region.
    await openPanel(page);
    await expect(panel(page).getByRole("alert")).toHaveCount(0);
    await expect(composer(page)).toHaveValue("");
  });

  test("429 rate limiting shows the generic inline copy", async ({ page }) => {
    await page.route("**/api/ai/assistant", (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ error: "Too many requests. Please try again later." }),
      }),
    );

    await page.goto("/dashboard");
    await openPanel(page);
    await composer(page).fill("anything");
    await composer(page).press("Enter");

    await expect(panel(page).getByRole("alert")).toHaveText("You've sent a lot of requests. Try again in a little while.");
    await page.unroute("**/api/ai/assistant");
  });

  test("dark mode: no light-only surfaces on the panel", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/dashboard");
    await openPanel(page);
    const dialogBg = await panel(page).evaluate((el) => getComputedStyle(el).backgroundColor);
    // Not pure white in dark mode — a token-based surface color resolves
    // to something else; this is a coarse smoke check, not a full visual
    // regression suite.
    expect(dialogBg).not.toBe("rgb(255, 255, 255)");
  });
});

test.describe("mobile / narrow viewport", () => {
  test.use({ viewport: { width: 375, height: 700 } });

  test.beforeEach(async ({ context, baseURL }) => {
    await actAsStaff(context, baseURL!, fixtures.owner, fixtures.orgA.id);
  });

  test("full-screen dialog, no horizontal overflow, composer/submit/close all reachable", async ({ page }) => {
    await page.goto("/dashboard");
    await openPanel(page);

    const box = await panel(page).boundingBox();
    expect(box?.width).toBeLessThanOrEqual(375);

    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(hasHorizontalOverflow).toBe(false);

    await expect(composer(page)).toBeVisible();
    await expect(panel(page).getByRole("button", { name: "Ask", exact: true })).toBeVisible();
    await expect(panel(page).getByRole("button", { name: "Close AI Assistant" })).toBeVisible();
  });
});

test.describe("320px viewport", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test.beforeEach(async ({ context, baseURL }) => {
    await actAsStaff(context, baseURL!, fixtures.owner, fixtures.orgA.id);
  });

  test("no overflow at 320px, close/composer/submit reachable, suggested prompts wrap", async ({ page }) => {
    await page.goto("/dashboard");
    await openPanel(page);

    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(hasHorizontalOverflow).toBe(false);

    await expect(panel(page).getByRole("button", { name: "Close AI Assistant" })).toBeVisible();
    await expect(composer(page)).toBeVisible();
    await expect(panel(page).getByRole("button", { name: "Ask", exact: true })).toBeVisible();
    await expect(panel(page).getByRole("button", { name: "Which clients were added recently?" })).toBeVisible();
  });

  test("a near-max-length answer wraps without overflowing at 320px", async ({ page }) => {
    const longAnswer = "This is a very long unbroken answer sentence that must wrap safely inside the panel without ever forcing the page to scroll horizontally on a narrow 320px viewport. ".repeat(6);
    await page.route("**/api/ai/assistant", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ answer: longAnswer }) }),
    );

    await page.goto("/dashboard");
    await openPanel(page);
    await composer(page).fill("give me a long answer");
    await composer(page).press("Enter");
    await expect(panel(page).getByText(longAnswer.trim().slice(0, 40), { exact: false })).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(hasHorizontalOverflow).toBe(false);
    await page.unroute("**/api/ai/assistant");
  });
});

test.describe("Portal / Platform Admin absence", () => {
  test("Portal has no AI trigger in the DOM", async ({ context, baseURL, page }) => {
    await injectTestSession(context, { id: fixtures.portalUser.id, email: fixtures.portalUser.email }, baseURL!);
    void page;
    const portalPage = await context.newPage();
    await portalPage.goto("/portal");
    await expect(portalPage.getByRole("button", { name: "AI Assistant" })).toHaveCount(0);
  });

  test("Platform Admin has no AI trigger in the DOM", async ({ context, baseURL }) => {
    await injectTestSession(context, { id: "e2e-ai-drawer-platform-admin", email: "platform-admin-e2e@example.com" }, baseURL!);
    const adminPage = await context.newPage();
    await adminPage.goto("/platform-admin");
    await expect(adminPage.getByRole("button", { name: "AI Assistant" })).toHaveCount(0);
  });
});
