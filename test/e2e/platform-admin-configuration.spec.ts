import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { injectTestSession } from "../support/e2e-session";
import { dbQuery } from "./fixtures";

/**
 * Sale-Ready Phase D, D1 (Platform Configuration — foundation + Legal
 * Configuration surface). Its own file, matching the precedent PR2's
 * Dashboard already set: Configuration is a genuinely new top-level
 * feature area (its own nav entry), not an extension of an existing one
 * the way PR3.2/PR3.3 extended the Organizations file. Guard/nav coverage
 * stays in platform-admin.spec.ts (already updated for the new nav entry)
 * and isn't repeated here.
 */

const PLATFORM_ADMIN_EMAIL = "platform-admin-e2e@example.com";
const BASE_PATH = "/platform-admin/configuration";

test("renders the Legal Configuration section with the real (fallback) platform legal config", async ({ context, baseURL }) => {
  await injectTestSession(context, { id: "e2e-platform-admin-configuration", email: PLATFORM_ADMIN_EMAIL }, baseURL!);
  const page = await context.newPage();
  await page.goto(BASE_PATH);

  await expect(page.getByRole("heading", { level: 1, name: "Configuration" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Legal Configuration" })).toBeVisible();

  const legalSection = page.getByRole("region", { name: "Legal Configuration" });
  await expect(legalSection).toBeVisible();

  // TEST_MODE's webServer env (playwright.config.ts) sets none of the
  // PLATFORM_LEGAL_* vars, so this exercises getPlatformLegalConfig()'s
  // own real fallback chain — the same one production runs today with
  // PLATFORM_LEGAL_NAME unset (see the Legal Foundation PR's own tests).
  await expect(legalSection.getByText("Legal name", { exact: true })).toBeVisible();
  await expect(legalSection.getByText("Client Portal CRM")).toBeVisible();
  await expect(legalSection.getByText("Jurisdiction", { exact: true })).toBeVisible();
  await expect(legalSection.getByText("the jurisdiction in which the Service operator is located")).toBeVisible();
  await expect(legalSection.getByText("Registered address", { exact: true })).toBeVisible();
  await expect(legalSection.getByText("Not set").first()).toBeVisible();
  await expect(legalSection.getByText("Privacy Policy effective date", { exact: true })).toBeVisible();
  await expect(legalSection.getByText("Terms of Service effective date", { exact: true })).toBeVisible();
});

test("an ordinary tenant user is redirected away from Configuration", async ({ context, baseURL }) => {
  const userId = randomUUID();
  await injectTestSession(context, { id: userId, email: `e2e-configuration-ordinary-${Date.now()}@example.com` }, baseURL!);
  const page = await context.newPage();
  try {
    // Visiting /dashboard as a fresh identity auto-provisions a real
    // Organization/Membership/Subscription (current-user.ts's own
    // getOrCreateOrganizationId) — a valid UUID id is required for that
    // real Prisma upsert to succeed, unlike the allowlisted-admin test
    // above, whose identity never reaches Prisma at all.
    await page.goto(BASE_PATH);
    await page.waitForURL(/\/dashboard$/);
  } finally {
    await dbQuery("organization", "deleteMany", {
      where: { id: (await dbQuery<{ organizationId: string }>("membership", "findFirstOrThrow", { where: { userId } })).organizationId },
    });
    await dbQuery("user", "delete", { where: { id: userId } });
  }
});

test("an anonymous visitor is redirected to login", async ({ page }) => {
  await page.goto(BASE_PATH);
  await expect(page).toHaveURL(/\/login$/);
});
