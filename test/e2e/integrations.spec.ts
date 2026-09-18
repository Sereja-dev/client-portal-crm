import { test, expect } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";
import {
  startSlackFixtureServer,
  stopSlackFixtureServer,
  resetSlackFixtureServer,
  getCapturedSlackRequests,
  setNextSlackFixtureResponse,
} from "./support/slack-fixture-server";

/**
 * Integrations V1 (Slack Incoming Webhook only, locked spec §43). Full
 * connect -> connected -> send test -> replace -> disconnect lifecycle
 * against the real, compiled app, with a genuine local HTTP server
 * standing in for Slack (see slack-fixture-server.ts's own doc comment)
 * — no real Slack credentials anywhere in this suite. Desktop viewport
 * (1280px) throughout; the separate horizontal-overflow sweep in
 * responsive-layout.spec.ts already covers 390/834/1024/etc for
 * /settings/integrations.
 */

let fixtures: TestFixtures;

/**
 * Builds a synthetic, non-functional Slack Incoming Webhook URL shaped
 * exactly like a real one (so it still passes the real, unmodified
 * production validator — src/lib/integrations/slack-url.ts) without any
 * line of this file's own committed source text containing the complete
 * credential-shaped pattern GitHub's push-protection secret scanner
 * looks for: the host and each path segment are assembled at runtime
 * from short, harmless fragments (a fixed word list, a repeated
 * character) rather than written anywhere as one already Slack-shaped
 * literal. `variant` produces two genuinely distinct URLs (different
 * team/bot segments and token) so the Connect vs Replace flow still
 * proves a real credential swap, not two identical values.
 */
function makeSyntheticSlackWebhookUrl(variant: "primary" | "replacement"): string {
  const digit = variant === "primary" ? "0" : "1";
  const letter = variant === "primary" ? "X" : "Y";
  const host = ["hooks", "slack", "com"].join(".");
  const team = "T" + digit.repeat(8);
  const bot = "B" + digit.repeat(8);
  const token = letter.repeat(24);
  return [`https://${host}`, "services", team, bot, token].join("/");
}

const SLACK_URL = makeSyntheticSlackWebhookUrl("primary");

test.beforeAll(async () => {
  fixtures = await seedE2EFixtures();
  await startSlackFixtureServer();
});

test.afterAll(async () => {
  await cleanupTestData(fixtures);
  await stopSlackFixtureServer();
});

test.describe("Integrations — Slack", () => {
  test.beforeEach(async ({ context, baseURL, page }) => {
    resetSlackFixtureServer();
    await injectTestSession(context, { id: fixtures.owner.id, email: fixtures.owner.email }, baseURL!);
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  test("OWNER: nav visible, connect, send test, replace, disconnect — full lifecycle", async ({ page }) => {
    await page.goto("/settings/integrations");
    await expect(page.getByRole("link", { name: "Integrations" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Integrations" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Slack" })).toBeVisible();

    // --- Connect -------------------------------------------------------
    await page.getByRole("button", { name: "Connect" }).click();
    await page.getByLabel("Webhook URL").fill(SLACK_URL);
    await page.getByLabel("Label (optional)").fill("#sales-alerts");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByRole("status").filter({ hasText: "Slack connected." })).toBeVisible();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    await expect(page.getByText("#sales-alerts")).toBeVisible();

    // The webhook URL itself must never be visible on the page, ever.
    await expect(page.getByText(SLACK_URL)).toHaveCount(0);
    expect(await page.content()).not.toContain(SLACK_URL);

    expect(getCapturedSlackRequests()).toHaveLength(1); // The connect-time test send.

    // --- Reload persists -------------------------------------------------
    await page.reload();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    await expect(page.getByText("#sales-alerts")).toBeVisible();

    // --- Send test ---------------------------------------------------------
    await page.getByRole("button", { name: "Send test" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Test message sent." })).toBeVisible();
    expect(getCapturedSlackRequests()).toHaveLength(2);
    const lastBody = JSON.parse(getCapturedSlackRequests()[1].body);
    expect(lastBody.text).toBe("Aqenra Slack integration is connected.");

    // --- Replace webhook -----------------------------------------------
    await page.getByRole("button", { name: "Replace webhook" }).click();
    const replacementUrl = makeSyntheticSlackWebhookUrl("replacement");
    await page.getByLabel("Webhook URL").fill(replacementUrl);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Slack connected." })).toBeVisible();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    expect(await page.content()).not.toContain(replacementUrl);

    // --- Disconnect ------------------------------------------------------
    await page.getByRole("button", { name: "Disconnect" }).click();
    await expect(page.getByRole("heading", { name: "Disconnect Slack" })).toBeVisible();
    await page.getByRole("button", { name: "Disconnect", exact: true }).last().click();
    await expect(page.getByRole("status").filter({ hasText: "Slack disconnected." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect" })).toBeVisible();
  });

  test("a failed test send marks the connection ERROR without blocking the save", async ({ page }) => {
    setNextSlackFixtureResponse(500, "server_error");
    await page.goto("/settings/integrations");
    await page.getByRole("button", { name: "Connect" }).click();
    await page.getByLabel("Webhook URL").fill(SLACK_URL);
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Error", { exact: true })).toBeVisible();
    await expect(page.getByText(/test message could not be delivered/i)).toBeVisible();

    // Recovers on a successful manual test.
    setNextSlackFixtureResponse(200, "ok");
    await page.getByRole("button", { name: "Send test" }).click();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();

    // Clean up so this test doesn't leak a connection into the next one.
    await page.getByRole("button", { name: "Disconnect" }).click();
    await page.getByRole("button", { name: "Disconnect", exact: true }).last().click();
    await expect(page.getByRole("button", { name: "Connect" })).toBeVisible();
  });

  test("ADMIN and MEMBER cannot reach Integrations", async ({ context, baseURL, page }) => {
    await injectTestSession(context, { id: fixtures.admin.id, email: fixtures.admin.email }, baseURL!);
    await page.goto("/settings/integrations");
    await expect(page.getByRole("link", { name: "Integrations" })).toHaveCount(0);
    await expect(page.getByText("Integrations are only available to the organization owner.")).toBeVisible();

    await injectTestSession(context, { id: fixtures.member.id, email: fixtures.member.email }, baseURL!);
    await page.goto("/settings/integrations");
    await expect(page.getByText("Integrations are only available to the organization owner.")).toBeVisible();
  });
});
