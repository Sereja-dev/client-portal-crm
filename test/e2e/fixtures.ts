import type { Locator } from "@playwright/test";

// E2E test files cannot import @/lib/prisma directly — Playwright Test's
// own transform can't load the generated Prisma client (see test/e2e/
// db-server.ts's header comment). These re-exports are the HTTP-backed
// equivalents test/e2e specs should use instead; the underlying fixture
// graph is identical to Stage 4's (test/fixtures/seed.ts), just reached
// over test/e2e/db-server.ts rather than in-process.
export { seedFixtures as seedE2EFixtures, cleanupFixtures as cleanupTestData, dbQuery } from "../support/e2e-db-client";
export type { TestFixtures } from "../fixtures/seed";

/**
 * Sidebar Information Architecture — a handful of destinations that used
 * to be direct top-level sidebar links (Analytics, Reports, Calendar,
 * Billing, Activity, Projects, Tasks, Invoices) now live inside a
 * collapsible group (native <details>/<summary>, src/components/layout/
 * sidebar.tsx). A closed group's own child links are not visible/
 * actionable, so any spec clicking or asserting visibility on one of
 * those must open its parent group first — this one shared helper is
 * that open step, used instead of duplicating the same DOM manipulation
 * in every affected spec file.
 *
 * Sets the real native `open` property directly (never a `.click()` on
 * the <summary>, whose own implicit ARIA role isn't worth depending on
 * here) — idempotent and safe to call even when the group already
 * happens to be open (e.g. because it's already the active section).
 * `nav` is always the already-scoped Primary sidebar `<nav>` locator the
 * calling spec already has.
 */
export async function openSidebarGroup(nav: Locator, groupLabel: string): Promise<void> {
  const summary = nav.locator("summary", { hasText: groupLabel });
  await summary.evaluate((el) => {
    const details = el.closest("details");
    if (details) details.open = true;
  });
}
