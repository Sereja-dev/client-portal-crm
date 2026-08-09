import { defineConfig, devices } from "@playwright/test";
import { TEST_DATABASE_URL } from "./test/support/local-postgres";
import { E2E_APP_PORT } from "./test/support/e2e-ports";

// Applies to this config-loading process itself (so test files that
// import @/lib/prisma directly — e.g. to seed/clean up fixtures — connect
// to the same test database the webServer below is pointed at), NOT to
// the webServer process, which gets its own explicit `env` block.
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.PGLITE_TEST_DB = "1";

const PORT = E2E_APP_PORT;

export default defineConfig({
  testDir: "./test/e2e",
  // One shared PGlite instance backs the whole run (see test/support/
  // local-postgres.ts) — its socket server can only service one
  // connection at a time (see src/lib/prisma.ts's PGLITE_TEST_DB pool
  // cap), so parallel test files/workers would contend for it.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // Never masks a real bug with a blind retry — a genuinely flaky test
  // still fails on CI's 2nd attempt, it just doesn't fail the whole run
  // on a single transient blip. 0 locally, so a real failure is never
  // silently retried away during development.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }]] : "list",
  timeout: 30_000,
  globalSetup: "./test/e2e/global-setup.ts",
  globalTeardown: "./test/e2e/global-teardown.ts",
  // Playwright's own artifact directories — already covered by .gitignore
  // (test-results/, playwright-report/), never committed.
  outputDir: "./test-results",
  use: {
    baseURL: process.env.TEST_APP_URL ?? `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // A real production build, not the dev server — matches how the app
    // actually runs, and dev-server HMR/overlay behavior has no place in
    // E2E assertions. Requires `npm run build` to have already produced
    // .next/ (see package.json's test:e2e script and the Stage 5 report).
    //
    // --keepAliveTimeout: Node's http server defaults to a 5s keep-alive
    // timeout, which can close a reused socket at the exact moment a
    // client sends a new request on it — Next's own CLI docs describe
    // this race under "Configuring a timeout for downstream proxies".
    // Observed once directly against this suite's own Chromium instance
    // (a "200 headers, then the body aborts" response) while debugging a
    // stuck Server Action call — raising it removes that whole failure
    // mode regardless of how often it would otherwise fire.
    command: `npm run start -- -p ${PORT} --keepAliveTimeout 60000`,
    url: `http://127.0.0.1:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      PGLITE_TEST_DB: "1",
      // TEST_MODE gates src/lib/test-mode.ts's identity bypass — set ONLY
      // here, for this one spawned process, never for a real deployment.
      // See scripts/security-checks/check-no-test-mode.mjs.
      TEST_MODE: "1",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
      // Only needed so deliverNotificationEmails's own "is the provider
      // configured" check (Boolean(process.env.INVITATION_FROM_EMAIL))
      // passes — the actual send is intercepted by sendEmailViaResend's
      // TEST_MODE branch before this value (or RESEND_API_KEY, which stays
      // unset) is ever used for a real network call.
      INVITATION_FROM_EMAIL: "Test <test@example.com>",
      // Sale-Ready Phase C — a fixed, single allowlisted identity so
      // test/e2e/platform-admin.spec.ts can inject a session for exactly
      // this email and exercise the real requirePlatformAdmin() allow
      // path, alongside any other injected identity (e.g. a seeded
      // fixture user) exercising the real deny path.
      PLATFORM_ADMIN_EMAILS: "platform-admin-e2e@example.com",
    },
  },
});
