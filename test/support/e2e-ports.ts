/**
 * Single source of truth for the two fixed ports the E2E suite binds to —
 * previously hardcoded independently in playwright.config.ts, test/e2e/
 * db-server.ts, test/e2e/global-setup.ts, and test/support/e2e-db-client.ts,
 * which could silently drift out of sync. Neither is configurable (unlike
 * TEST_DATABASE_URL's port in test/support/local-postgres.ts, which only
 * this process ever binds to): both must stay fixed so a human running
 * `npm run test:e2e` locally and CI agree on where things live without any
 * extra env wiring.
 */

/** Where playwright.config.ts's webServer runs the real `next start` build — distinct from the local dev server's 3000. */
export const E2E_APP_PORT = 3100;

/** Where test/e2e/db-server.ts (the tsx-subprocess Prisma proxy) listens, loopback-only. */
export const E2E_DB_SERVER_PORT = 3101;

/**
 * Where test/e2e/support/slack-fixture-server.ts binds — a local,
 * loopback-only stand-in for Slack's own Incoming Webhook endpoint.
 * Integrations V1 (locked spec §37): the app process itself is told
 * about this fixed address via TEST_SLACK_FIXTURE_BASE_URL
 * (playwright.config.ts's own webServer env), which
 * src/lib/integrations/slack-client.ts only ever reads under TEST_MODE —
 * the production URL allowlist (hooks.slack.com only) is never weakened,
 * only the outbound transport's own destination is swapped, deliberately
 * mirroring src/lib/invoices/pdf/logo.ts's own TEST_MODE branch.
 */
export const E2E_SLACK_FIXTURE_PORT = 3102;
