import { test, expect } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";
import { E2E_APP_PORT } from "../support/e2e-ports";

/**
 * Platform Admin dedicated hostname (owner-approved convenience). Exercises
 * the real middleware.ts hostname rule end to end — never by mocking the
 * rule itself, only by sending requests whose Host differs. Two layers:
 *
 *  - The `request` fixture (no browser) sends a real HTTP request to the
 *    real running server with an explicit `host` header override, proven
 *    safe/honored for this exact purpose by a disposable local probe
 *    before this file was written (a plain Node http server echoing
 *    req.headers.host back, hit through Playwright's own `request`
 *    context) — this is the right tool for the pure routing-decision
 *    assertions (does hostname X get the admin-root rule, yes/no), with
 *    no DNS involved at all.
 *  - A real browser (Chromium), launched per this file only with
 *    `--host-resolver-rules` mapping admin.aqenra.com and app.aqenra.com to
 *    127.0.0.1 (confirmed working the same way by a second disposable
 *    local probe before this file was written) — needed for the tests that
 *    require a real cookie jar and real same-origin navigation to prove
 *    host-only cookie isolation between the two hostnames.
 *
 * SANDBOX LIMITATION (disclosed honestly, matching test-mode.ts's own
 * note): this sandbox has no real Supabase Auth instance, so no test here
 * submits the real login form with real credentials — exactly like every
 * existing Platform Admin E2E test (test/e2e/platform-admin.spec.ts), which
 * also never drives a real login. Where this suite needs "already signed
 * in," it uses the same established injectTestSession() identity bypass
 * every other Platform Admin E2E test already relies on. This proves the
 * exact same code path a real login's own redirect would take
 * (LoginPage's "if (user) redirect(redirectTo)" branch, unmodified by this
 * change) — it does not, and cannot, prove the real Supabase
 * signInWithPassword() call itself behaves identically on this hostname;
 * that remains an external dependency to verify in the later, separately
 * approved Production stage.
 */

// Reuses the exact email playwright.config.ts's webServer env already
// allowlists in PLATFORM_ADMIN_EMAILS for test/e2e/platform-admin.spec.ts —
// deliberately not a second address, so this file needs no config change.
const PLATFORM_ADMIN_EMAIL = "platform-admin-e2e@example.com";
const ADMIN_HOST = "admin.aqenra.com";
const APP_HOST = "app.aqenra.com";
const ADMIN_ORIGIN = `http://${ADMIN_HOST}:${E2E_APP_PORT}`;
const APP_ORIGIN = `http://${APP_HOST}:${E2E_APP_PORT}`;

// Top-level, applying to the whole file (Playwright requires launchOptions
// overrides at the top level, not inside a describe block, since they force
// a dedicated worker/browser instance). Harmless for the request-fixture
// tests below, which never launch a page/browser context at all.
test.use({
  launchOptions: {
    args: [`--host-resolver-rules=MAP ${ADMIN_HOST} 127.0.0.1,MAP ${APP_HOST} 127.0.0.1`],
  },
});

let fixtures: TestFixtures;

test.beforeAll(async () => {
  fixtures = await seedE2EFixtures();
});

test.afterAll(async () => {
  await cleanupTestData(fixtures);
});

test.describe("admin hostname root routing (raw HTTP, exact-hostname rule, no DNS required)", () => {
  test("exact admin hostname root redirects to /login with redirectTo=/platform-admin, on the same hostname", async ({
    request,
    baseURL,
  }) => {
    const res = await request.get(new URL("/", baseURL).toString(), {
      headers: { host: `${ADMIN_HOST}:${E2E_APP_PORT}` },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(307);
    // NextResponse.redirect() requires an absolute URL (Next.js itself
    // throws "Please use only absolute URLs" for a relative one). The
    // open-redirect question is that this absolute URL's host is exactly
    // the one hostname already matched above — never a different,
    // attacker-supplied host — and its path/query are a hardcoded literal.
    expect(res.headers()["location"]).toBe(`http://${ADMIN_HOST}:${E2E_APP_PORT}/login?redirectTo=%2Fplatform-admin`);
  });

  test("main application hostname root keeps its existing (non-redirect) behaviour", async ({ request, baseURL }) => {
    const res = await request.get(new URL("/", baseURL).toString(), {
      headers: { host: `${APP_HOST}:${E2E_APP_PORT}` },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(200);
  });

  test("a request with no Host override at all keeps its existing (non-redirect) behaviour", async ({ request, baseURL }) => {
    const res = await request.get(new URL("/", baseURL).toString(), { maxRedirects: 0 });
    expect(res.status()).toBe(200);
  });

  test("a deceptive lookalike hostname does not activate the admin host rule", async ({ request, baseURL }) => {
    const res = await request.get(new URL("/", baseURL).toString(), {
      headers: { host: `${ADMIN_HOST}.attacker.example:${E2E_APP_PORT}` },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(200);
  });

  test("a hostname that merely contains the admin hostname as a prefix does not activate the rule", async ({
    request,
    baseURL,
  }) => {
    const res = await request.get(new URL("/", baseURL).toString(), {
      headers: { host: `not-${ADMIN_HOST}:${E2E_APP_PORT}` },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(200);
  });

  test("the admin hostname on a non-root path is unaffected — no broader host policy", async ({ request, baseURL }) => {
    const res = await request.get(new URL("/login", baseURL).toString(), {
      headers: { host: `${ADMIN_HOST}:${E2E_APP_PORT}` },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(200);
  });

  test("no redirect loop: the one redirect hop lands on an ordinary, non-redirecting /login render", async ({
    request,
    baseURL,
  }) => {
    const first = await request.get(new URL("/", baseURL).toString(), {
      headers: { host: `${ADMIN_HOST}:${E2E_APP_PORT}` },
      maxRedirects: 0,
    });
    expect(first.status()).toBe(307);
    const next = first.headers()["location"]!;
    // Reconnects to the real baseURL (127.0.0.1) with the same Host header
    // override as every other test in this block — reusing `next`'s own
    // absolute admin.aqenra.com URL as the actual connection target would
    // require real DNS resolution for that hostname, which this sandbox
    // deliberately has none of (see the file header's own explanation of
    // why the request fixture is used at all).
    const nextPathAndQuery = new URL(next).pathname + new URL(next).search;
    const second = await request.get(new URL(nextPathAndQuery, baseURL).toString(), {
      headers: { host: `${ADMIN_HOST}:${E2E_APP_PORT}` },
      maxRedirects: 0,
    });
    expect(second.status()).toBe(200);
  });

  test("an unsafe redirectTo reaching /login on the admin hostname still falls back safely (pre-existing sanitizeRedirectPath, unmodified)", async ({
    request,
    baseURL,
  }) => {
    const res = await request.get(new URL("/login?redirectTo=https%3A%2F%2Fevil.example", baseURL).toString(), {
      headers: { host: `${ADMIN_HOST}:${E2E_APP_PORT}` },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(200);
    const body = await res.text();
    // The actual hidden form field (the only thing a real form submission
    // ever sends back as redirectTo) carries the sanitized fallback, never
    // the attacker-supplied absolute URL. Deliberately not a blanket
    // "body doesn't contain evil.example" check — Next's own RSC payload
    // harmlessly echoes the raw, as-received searchParams prop elsewhere
    // in the page for hydration, which is unrelated to this form field and
    // not itself a redirect target.
    expect(body).toContain('<input type="hidden" name="redirectTo" value="/dashboard"');
  });
});

test.describe("admin hostname full flow (real browser, host-resolver-rules, no real DNS or system hosts-file change)", () => {
  test("anonymous admin-host visitor reaches the login form on the same hostname, with the platform-admin return path", async ({
    page,
  }) => {
    await page.goto(`${ADMIN_ORIGIN}/`);
    await expect(page).toHaveURL(`${ADMIN_ORIGIN}/login?redirectTo=%2Fplatform-admin`);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("an already-authorized-admin session on the admin hostname is carried through / to /platform-admin", async ({
    context,
  }) => {
    // Sandbox limitation (see file header): this simulates "already signed
    // in" via the established TEST_MODE identity bypass, not a real
    // credentialed login. It proves LoginPage's existing "if (user)
    // redirect(redirectTo)" branch — unmodified by this change — carries
    // an authorized admin all the way from "/" to "/platform-admin" on
    // this hostname.
    await injectTestSession(context, { id: "e2e-admin-host-platform-admin", email: PLATFORM_ADMIN_EMAIL }, ADMIN_ORIGIN);
    const page = await context.newPage();
    await page.goto(`${ADMIN_ORIGIN}/`);
    await expect(page).toHaveURL(`${ADMIN_ORIGIN}/platform-admin`);
    await expect(page.getByRole("heading", { name: "Platform Dashboard", level: 1 })).toBeVisible();
  });

  test("a signed-in non-admin on the admin hostname is denied Platform Admin, including direct navigation", async ({
    context,
  }) => {
    await injectTestSession(context, { id: fixtures.owner.id, email: fixtures.owner.email }, ADMIN_ORIGIN);
    const page = await context.newPage();

    await page.goto(`${ADMIN_ORIGIN}/`);
    await expect(page).toHaveURL(`${ADMIN_ORIGIN}/dashboard`);

    // Direct navigation to a nested Platform Admin page, not just the root.
    await page.goto(`${ADMIN_ORIGIN}/platform-admin/organizations`);
    await expect(page).toHaveURL(`${ADMIN_ORIGIN}/dashboard`);
    await expect(page.getByText("Access denied")).toHaveCount(0);
  });

  test("the existing app.aqenra.com/platform-admin fallback remains accessible to the authorized admin, unaffected by this change", async ({
    context,
  }) => {
    await injectTestSession(context, { id: "e2e-admin-host-fallback", email: PLATFORM_ADMIN_EMAIL }, APP_ORIGIN);
    const page = await context.newPage();
    await page.goto(`${APP_ORIGIN}/platform-admin`);
    await expect(page).toHaveURL(`${APP_ORIGIN}/platform-admin`);
    await expect(page.getByRole("heading", { name: "Platform Dashboard", level: 1 })).toBeVisible();
  });

  test("host-only cookie isolation: a session cookie scoped to app.aqenra.com is not sent to admin.aqenra.com", async ({
    context,
  }) => {
    // No Domain attribute is added anywhere by this change (B in the task
    // brief) — this proves, with a real browser cookie jar rather than a
    // static assertion, that the existing host-only scope genuinely holds
    // across these two hostnames.
    await injectTestSession(context, { id: "e2e-cookie-isolation", email: PLATFORM_ADMIN_EMAIL }, APP_ORIGIN);
    const page = await context.newPage();

    // The same identity IS recognized on the hostname the cookie was
    // actually scoped to.
    await page.goto(`${APP_ORIGIN}/platform-admin`);
    await expect(page).toHaveURL(`${APP_ORIGIN}/platform-admin`);

    // The identical browser context, same cookie jar, a different
    // hostname: treated as having no session at all.
    await page.goto(`${ADMIN_ORIGIN}/platform-admin`);
    await expect(page).toHaveURL(/\/login\?reason=session_expired$/);
  });
});
