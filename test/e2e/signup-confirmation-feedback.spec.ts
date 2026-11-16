import { test, expect } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, type TestFixtures } from "./fixtures";

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
 *
 * Recovery-guidance correction: the original wording asserted "you can
 * create your account again below" on both flows, implying resubmitting
 * the form would succeed — never verified against Supabase's real retry
 * behavior for an existing, still-unconfirmed signup (a mocked/enabled
 * form proves the form is reachable, not that Supabase's Admin API will
 * accept a second attempt for the same email). The wording now leads
 * with each flow's own actually-verified path: Staff's real, already-
 * working Support widget (proven below to open AND submit successfully
 * from this exact invalid-link state, not just generally on /signup);
 * Portal's real invitation origin (confirmed: no UI anywhere links to
 * /portal/signup without an invitationToken, so "the company that
 * invited you" is a true statement, never a claim that Aqenra itself
 * will resend anything). Retrying the form is still mentioned as
 * something the user MAY try, never as a guaranteed fix.
 */

test.describe("Staff signup — invalid/expired confirmation link feedback", () => {
  test("a plain visit to /signup shows no invalid-link message", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible();
    await expect(page.getByText(/invalid or has expired/i)).toHaveCount(0);
  });

  test("/signup?invalid=1 shows the invalid-or-expired message, leads with Support rather than promising the retry will work, and the form stays fully usable", async ({
    page,
  }) => {
    await page.goto("/signup?invalid=1");
    await expect(page.getByText(/That confirmation link is invalid or has expired/i)).toBeVisible();
    await expect(page.getByText(/Contact Support for help/i)).toBeVisible();

    // Never asserts the old, unverified "you can create your account
    // again" framing — retrying is offered as something the user MAY
    // try ("you can try... again"), never a promised outcome.
    await expect(page.getByText(/you can create your account again/i)).toHaveCount(0);
    await expect(page.getByText(/try signing up again/i)).toBeVisible();

    // The form itself is still the real, functional recovery path — not
    // replaced or disabled by the new message.
    await expect(page.locator("#organizationName")).toBeEnabled();
    await expect(page.locator("#email")).toBeEnabled();
    await expect(page.locator("#password")).toBeEnabled();
    await expect(page.locator("#confirmPassword")).toBeEnabled();
    await expect(page.getByRole("button", { name: "Create account" })).toBeEnabled();
  });

  test("the Support control the message points to actually opens and completes a real submission from this exact invalid-link state", async ({
    page,
  }) => {
    await page.goto("/signup?invalid=1");
    const trigger = page.getByRole("button", { name: "Contact Aqenra Support" });
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(page.getByRole("heading", { name: "Aqenra Support" })).toBeVisible();

    await page.getByLabel("Email address").fill("audit-recovery-check@example.com");
    await page.getByLabel("Issue type").selectOption("cant-sign-up");
    await page.getByLabel("Message").fill("My confirmation link said it was invalid or expired and I need help.");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText(/Your message has been sent\. We.ll reply to your email\./)).toBeVisible();
  });

  test("a real /auth/confirm request with an unverifiable signup token lands on /signup?invalid=1 with the message visible, and never authenticates", async ({
    page,
  }) => {
    await page.goto("/auth/confirm?token_hash=e2e-unverifiable&type=signup&next=%2Fdashboard");
    await expect(page).toHaveURL(/\/signup\?invalid=1$/);
    await expect(page.getByText(/That confirmation link is invalid or has expired/i)).toBeVisible();
  });
});

test.describe("Staff signup — invitation context is preserved", () => {
  let fixtures: TestFixtures;

  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test("a normal (non-invalid) invited visit still shows the inviting organization, unaffected by the new message", async ({
    page,
  }) => {
    await page.goto(`/signup?invitationToken=${fixtures.invitation.token}`);
    await expect(page.getByText("Test Org A")).toBeVisible();
    await expect(page.getByText(/invalid or has expired/i)).toHaveCount(0);
  });
});

test.describe("Client Portal signup — invalid/expired confirmation link feedback", () => {
  test("a plain visit to /portal/signup shows no invalid-link message", async ({ page }) => {
    await page.goto("/portal/signup");
    await expect(page.getByRole("heading", { name: "Create your Client Portal account" })).toBeVisible();
    await expect(page.getByText(/invalid or has expired/i)).toHaveCount(0);
  });

  test("/portal/signup?invalid=1 shows the invalid-or-expired message, points to the inviting company rather than promising a retry or an Aqenra-sent resend, never mentions Support (no such widget exists on this page), and the form stays fully usable", async ({
    page,
  }) => {
    await page.goto("/portal/signup?invalid=1");
    await expect(page.getByText(/That confirmation link is invalid or has expired/i)).toBeVisible();
    await expect(page.getByText(/contact the company that invited you/i)).toBeVisible();
    await expect(page.getByText(/request a new invitation/i)).toBeVisible();

    // Never claims Aqenra itself will resend anything, and never asserts
    // the old, unverified "you can create your account again" framing.
    await expect(page.getByText(/we('| wi)ll (resend|send).*invitation/i)).toHaveCount(0);
    await expect(page.getByText(/you can create your account again/i)).toHaveCount(0);
    await expect(page.getByText(/Support/i)).toHaveCount(0);

    await expect(page.locator("#email")).toBeEnabled();
    await expect(page.locator("#password")).toBeEnabled();
    await expect(page.locator("#confirmPassword")).toBeEnabled();
  });

  test("a real /auth/confirm request with an unverifiable portal_signup token lands on /portal/signup?invalid=1 with the message visible, and never authenticates", async ({
    page,
  }) => {
    await page.goto("/auth/confirm?token_hash=e2e-unverifiable&type=portal_signup&next=%2Fportal");
    await expect(page).toHaveURL(/\/portal\/signup\?invalid=1$/);
    await expect(page.getByText(/That confirmation link is invalid or has expired/i)).toBeVisible();
  });
});
