import { test, expect } from "@playwright/test";

/**
 * Signup-confirmation feedback fix (read-only audit finding: a failed,
 * expired, or already-used confirmation link redirected to
 * /signup?invalid=1 / /portal/signup?invalid=1 with no explanation at
 * all — pixel-identical to the plain signup form). These tests exercise
 * the real rendered page, not just the redirect target string already
 * covered by test/integration/auth/signup-confirmation-e2e.test.ts.
 *
 * The /auth/confirm navigations below rely on an existing, unrelated
 * fact rather than any new test-only seam: verifySignupOtp() in
 * src/app/auth/confirm/route.ts unconditionally returns null whenever
 * TEST_MODE is set (`if (!tokenHash || TEST_MODE) return null;`), which
 * this whole E2E suite always runs under. So any token value reaching
 * type=signup/type=portal_signup here deterministically fails closed —
 * the real route handler's own real redirect logic is exercised, not a
 * fake stand-in for it.
 */

test.describe("Staff signup — invalid/expired confirmation link feedback", () => {
  test("a plain visit to /signup shows no invalid-link message", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible();
    await expect(page.getByText(/invalid or has expired/i)).toHaveCount(0);
  });

  test("/signup?invalid=1 shows the invalid-or-expired message, and the form stays fully usable", async ({ page }) => {
    await page.goto("/signup?invalid=1");
    await expect(page.getByText(/That confirmation link is invalid or has expired/i)).toBeVisible();
    await expect(page.getByText(/contact\s*Support/i)).toBeVisible();

    // The form itself is still the real, functional recovery path — not
    // replaced or disabled by the new message.
    await expect(page.locator("#organizationName")).toBeEnabled();
    await expect(page.locator("#email")).toBeEnabled();
    await expect(page.locator("#password")).toBeEnabled();
    await expect(page.locator("#confirmPassword")).toBeEnabled();
    await expect(page.getByRole("button", { name: "Create account" })).toBeEnabled();
  });

  test("a real /auth/confirm request with an unverifiable signup token lands on /signup?invalid=1 with the message visible, and never authenticates", async ({ page }) => {
    await page.goto("/auth/confirm?token_hash=e2e-unverifiable&type=signup&next=%2Fdashboard");
    await expect(page).toHaveURL(/\/signup\?invalid=1$/);
    await expect(page.getByText(/That confirmation link is invalid or has expired/i)).toBeVisible();
  });
});

test.describe("Client Portal signup — invalid/expired confirmation link feedback", () => {
  test("a plain visit to /portal/signup shows no invalid-link message", async ({ page }) => {
    await page.goto("/portal/signup");
    await expect(page.getByRole("heading", { name: "Create your Client Portal account" })).toBeVisible();
    await expect(page.getByText(/invalid or has expired/i)).toHaveCount(0);
  });

  test("/portal/signup?invalid=1 shows the invalid-or-expired message, never mentions Support (no such widget exists on this page), and the form stays fully usable", async ({ page }) => {
    await page.goto("/portal/signup?invalid=1");
    await expect(page.getByText(/That confirmation link is invalid or has expired/i)).toBeVisible();
    await expect(page.getByText(/Support/i)).toHaveCount(0);

    await expect(page.locator("#email")).toBeEnabled();
    await expect(page.locator("#password")).toBeEnabled();
    await expect(page.locator("#confirmPassword")).toBeEnabled();
  });

  test("a real /auth/confirm request with an unverifiable portal_signup token lands on /portal/signup?invalid=1 with the message visible, and never authenticates", async ({ page }) => {
    await page.goto("/auth/confirm?token_hash=e2e-unverifiable&type=portal_signup&next=%2Fportal");
    await expect(page).toHaveURL(/\/portal\/signup\?invalid=1$/);
    await expect(page.getByText(/That confirmation link is invalid or has expired/i)).toBeVisible();
  });
});
