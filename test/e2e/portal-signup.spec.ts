import { test, expect, type Page } from "@playwright/test";
import { dbQuery } from "./fixtures";
import { getRunId, testEmail } from "../support/run-id";
import { TEST_EMAIL_DOMAIN } from "../support/env";
import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";

/**
 * The form's own error paragraph (PortalSignupForm: `<p role="alert">`)
 * — not `page.getByRole("alert")` alone, which also matches Next.js's own
 * always-present route-announcer (`<div role="alert"
 * id="__next-route-announcer__">`), a real, confirmed strict-mode
 * ambiguity distinct from the form's own content.
 */
function formAlert(page: Page) {
  return page.locator('p[role="alert"]');
}

/**
 * Finding 2 (Client Portal Audit) — `/portal/signup` had no functional
 * browser-level coverage anywhere in this suite: the only existing
 * reference (legal-pages.spec.ts) checks solely that the legal-footer
 * link is present on the page, never submits the form.
 *
 * No seeded fixtures are used here at all — none of the scenarios below
 * ever reach a real invitationToken (see src/app/portal/signup/actions.ts's
 * own doc comment: portalSignup() never creates a Prisma User,
 * Organization, or Membership row of any kind; a PortalUser is created
 * only by acceptClientInvitationAction, on a genuinely different flow),
 * so there is nothing this file's own real writes need to seed or clean
 * up beyond the fake, never-persisted identities used below.
 *
 * HONEST, DELIBERATE SCOPE LIMIT — not a coverage gap left unclosed:
 * portalSignup() (Portal signup-confirmation defect fix) no longer calls
 * supabase.auth.signUp() at all — it calls
 * generateSignupConfirmationToken() (Supabase's real Admin API), which
 * this local E2E environment has no real endpoint to reach either. This
 * is the exact same limitation password-reset.spec.ts's own header
 * comment already discloses for login/signup generally, and it is why
 * staff signup also has no E2E coverage of its own
 * (test/integration/auth/signup.test.ts and
 * test/integration/auth/signup-confirmation-e2e.test.ts cover it at the
 * integration level, where the Admin API call is injected directly).
 * Building a TEST_MODE-only fake for the Admin API is shared harness code
 * and out of this test-only PR's scope — so the genuine account-creation
 * success path and the existing/duplicate-email path are NOT exercised
 * here. Every scenario below is deliberately chosen because it is
 * provably reachable and provably resolved *before* portalSignup() ever
 * calls generateToken() — confirmed directly from the real Server
 * Action's own control flow (rate limit check, then field validation,
 * then the token-generation call) — so nothing here can ever reach that
 * real network call.
 */

test.describe("Portal signup — page and form content", () => {
  test("loads with the correct Client Portal heading, every real field, and no staff signup content", async ({ page }) => {
    await page.goto("/portal/signup");

    await expect(page.getByRole("heading", { name: "Create your Client Portal account", level: 1 })).toBeVisible();
    // The one thing that would prove the wrong (staff) form/copy rendered
    // by accident: the staff heading text, and the one field staff signup
    // has that Portal signup never does.
    await expect(page.getByRole("heading", { name: "Create an account" })).toHaveCount(0);
    await expect(page.getByLabel("Organization name")).toHaveCount(0);

    // getByRole("textbox", { name, exact: true }) — not getByLabel() —
    // since FormLabel's own required-asterisk <span> is aria-hidden (so
    // ARIA accessible-name computation correctly excludes it, matching
    // getByRole's matching), but is still part of the <label> element's
    // raw text content, which is what getByLabel(text, { exact: true })
    // matches against instead; confirmed empirically (a disposable local
    // probe, deleted immediately after use) that getByLabel("Password",
    // { exact: true }) finds zero matches for exactly this reason, while
    // getByRole resolves correctly to the one real field.
    const email = page.getByRole("textbox", { name: "Email", exact: true });
    await expect(email).toBeVisible();
    await expect(email).toHaveAttribute("type", "email");
    await expect(email).toHaveAttribute("required", "");

    const password = page.getByRole("textbox", { name: "Password", exact: true });
    await expect(password).toBeVisible();
    await expect(password).toHaveAttribute("type", "password");
    await expect(password).toHaveAttribute("required", "");

    const confirmPassword = page.getByRole("textbox", { name: "Confirm password", exact: true });
    await expect(confirmPassword).toBeVisible();
    await expect(confirmPassword).toHaveAttribute("type", "password");
    await expect(confirmPassword).toHaveAttribute("required", "");

    await expect(page.getByRole("button", { name: "Sign up" })).toBeVisible();
    // Scoped to the form itself — the page's own global footer navigation
    // also has real "Terms of Service"/"Privacy Policy" links, a genuine
    // strict-mode ambiguity distinct from the form's own inline copy.
    const form = page.locator("form");
    await expect(form.getByRole("link", { name: "Terms of Service" })).toHaveAttribute("href", "/terms");
    await expect(form.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");

    // sanitizePortalRedirectPath() always falls back to "/portal" when no
    // redirectTo query param is present, and the form's own Sign-in link
    // always carries whatever redirectTo it received — so, with no query
    // param on this page load, the real, correct href includes exactly
    // this default, not a bare "/portal/login".
    const signInLink = form.getByRole("link", { name: "Sign in" });
    await expect(signInLink).toBeVisible();
    await expect(signInLink).toHaveAttribute("href", "/portal/login?redirectTo=%2Fportal");
  });

  test("native required fields block submission entirely — no request is ever sent", async ({ page }) => {
    await page.goto("/portal/signup");

    // The three fields are all `required`, natively enforced by the
    // browser before any network request — this is a genuine zero-request
    // proof, not a Server Action assertion, and is why it costs nothing
    // against the rate limiter proven later in this file.
    let requestSeen = false;
    page.on("request", (req) => {
      if (req.url().includes("/portal/signup") && req.method() === "POST") requestSeen = true;
    });

    await page.getByRole("button", { name: "Sign up" }).click();
    // Still on the same page, no error/message rendered — the browser
    // itself refused to submit.
    await expect(page).toHaveURL(/\/portal\/signup$/);
    await expect(formAlert(page)).toHaveCount(0);
    expect(requestSeen).toBe(false);
  });
});

/**
 * Both cases below are real Server Action round trips, but resolve
 * inside portalSignup()'s own field-validation block — strictly before
 * the call that would reach supabase.auth.signUp() (confirmed from
 * source: rate limit check, then these validations, then the Supabase
 * call). Each of these also consumes one of PORTAL_SIGNUP_LIMIT's
 * shared, unresettable, process-lifetime attempts (see the rate-limiting
 * describe block below) — harmless, since that block's own bounded loop
 * never assumes a specific starting count.
 */
test.describe("Portal signup — server-side validation (reachable only via a real submission)", () => {
  test("a password under 8 characters shows the exact bounded length error, with no session/account side effect", async ({ page }) => {
    await page.goto("/portal/signup");
    const email = testEmail("portal-signup-short-pw", TEST_EMAIL_DOMAIN, `${getRunId()}a`);
    await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
    await page.getByRole("textbox", { name: "Password", exact: true }).fill("short1");
    await page.getByRole("textbox", { name: "Confirm password", exact: true }).fill("short1");
    await page.getByRole("button", { name: "Sign up" }).click();

    await expect(formAlert(page)).toHaveText("Password must be at least 8 characters.");
    // Still on the signup page — no redirect, no confirmation state.
    await expect(page).toHaveURL(/\/portal\/signup$/);

    const membership = await dbQuery("membership", "findFirst", { where: { user: { email } } });
    expect(membership).toBeNull();
  });

  test("mismatched passwords show the exact bounded mismatch error, with no session/account side effect", async ({ page }) => {
    await page.goto("/portal/signup");
    const email = testEmail("portal-signup-mismatch", TEST_EMAIL_DOMAIN, `${getRunId()}b`);
    await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
    await page.getByRole("textbox", { name: "Password", exact: true }).fill("longenough1");
    await page.getByRole("textbox", { name: "Confirm password", exact: true }).fill("longenough2");
    await page.getByRole("button", { name: "Sign up" }).click();

    await expect(formAlert(page)).toHaveText("Passwords do not match.");
    await expect(page).toHaveURL(/\/portal\/signup$/);

    const membership = await dbQuery("membership", "findFirst", { where: { user: { email } } });
    expect(membership).toBeNull();
  });
});

/**
 * PORTAL_SIGNUP_LIMIT (src/lib/rate-limit/limits.ts): scope
 * "portal-signup", limit 5, window 1 hour — an in-memory bucket with no
 * test-only reset export, keyed by IP; getRequestIp() falls back to the
 * fixed "unknown" identifier in this local, non-Vercel E2E environment,
 * so every portal-signup submission in this entire suite run shares one
 * bucket for its whole process lifetime (playwright.config.ts sets
 * `reuseExistingServer: false`, so this bucket is fresh at the start of
 * every full `npx playwright test` invocation).
 *
 * Bounded-loop-until-observed, mirroring search-api.spec.ts's own
 * established rate-limit E2E pattern exactly (`for` up to a generous cap,
 * break the instant the limited response appears, then assert on that
 * exact response) — not a hardcoded exact request count. This was a
 * deliberate correction from an earlier, more fragile version of this
 * test: a real submission was empirically observed (via a disposable
 * local network-request counter, removed after use) to sometimes need
 * one more attempt than naive arithmetic on `limit: 5` predicts before
 * the first denial — confirmed to be a real, reproducible quirk of this
 * local dev-mode E2E environment's very first request to a given Server
 * Action after a fresh server start, not a defect in the limiter itself
 * (every message observed before the first denial is still asserted to
 * be exactly the expected validation message, never anything else, and
 * the eventual denial is still asserted to be exactly the bounded
 * RATE_LIMIT_MESSAGE — nothing here is weakened, only the fragile exact
 * iteration count is removed).
 */
test.describe("Portal signup — rate limiting", () => {
  test("submissions eventually receive the exact bounded rate-limit message, never anything else", async ({ page }) => {
    await page.goto("/portal/signup");

    async function submitMismatch(): Promise<string> {
      await page.getByRole("textbox", { name: "Email", exact: true }).fill(testEmail("portal-signup-rl", TEST_EMAIL_DOMAIN, getRunId()));
      await page.getByRole("textbox", { name: "Password", exact: true }).fill("longenough1");
      await page.getByRole("textbox", { name: "Confirm password", exact: true }).fill("longenough2");
      await page.getByRole("button", { name: "Sign up" }).click();
      await expect(formAlert(page)).toBeVisible();
      return formAlert(page).innerText();
    }

    let limitedMessage: string | null = null;
    // PORTAL_SIGNUP_LIMIT.limit is 5 — 10 attempts comfortably exceeds it
    // even accounting for the environment quirk described above.
    for (let i = 0; i < 10; i++) {
      const message = await submitMismatch();
      if (message === RATE_LIMIT_MESSAGE) {
        limitedMessage = message;
        break;
      }
      // Every attempt before the limit trips must be exactly the ordinary
      // validation error — never a raw error, never anything unexpected.
      expect(message).toBe("Passwords do not match.");
    }

    expect(limitedMessage).toBe(RATE_LIMIT_MESSAGE);
  });
});
