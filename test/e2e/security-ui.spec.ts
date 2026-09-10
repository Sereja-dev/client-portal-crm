import { test, expect } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

// G. Security UI — a malicious redirectTo never escapes the app, and
// injected text renders as literal, inert text, never executes. Security
// HEADERS are checked via direct HTTP tests (test/integration or a plain
// fetch-based check), never via Playwright — a browser can't easily
// distinguish "header present" from "header present and enforced", and
// Playwright's own request piping can normalize/hide raw header behavior.

let fixtures: TestFixtures;

test.beforeAll(async () => {
  fixtures = await seedE2EFixtures();
  // Custom Statuses Phase 2B (Final E2E Fixture Sweep) — see
  // activity.spec.ts's own identical comment.
  await dbQuery("customStatusDefinition", "create", {
    data: {
      organizationId: fixtures.orgA.id,
      entityType: "CLIENT",
      key: "lead",
      label: "Lead",
      color: "NEUTRAL",
      position: 0,
      isDefault: true,
      isSystem: true,
    },
  });
});

test.afterAll(async () => {
  await dbQuery("customStatusDefinition", "deleteMany", { where: { organizationId: fixtures.orgA.id } });
  await cleanupTestData(fixtures);
});

test("a malicious redirectTo on the staff login never escapes the app", async ({ context, baseURL }) => {
  await injectTestSession(context, { id: fixtures.owner.id, email: fixtures.owner.email }, baseURL!);
  const page = await context.newPage();

  // sanitizeRedirectPath (src/lib/safe-redirect.ts) runs before the
  // already-authenticated redirect below fires — this exercises the exact
  // same sanitization a post-login redirect would go through, without
  // needing a real Supabase sign-in (unavailable under TEST_MODE).
  await page.goto("/login?redirectTo=https%3A%2F%2Fevil.example.com");
  await expect(page).toHaveURL(/\/dashboard/);
  expect(page.url()).not.toContain("evil.example.com");

  // Protocol-relative "//evil.com" is the other open-redirect shape
  // sanitizeRedirectPath specifically guards against.
  await page.goto("/login?redirectTo=%2F%2Fevil.example.com");
  await expect(page).toHaveURL(/\/dashboard/);
  expect(page.url()).not.toContain("evil.example.com");
});

test("a malicious redirectTo on the portal login never escapes /portal", async ({ context, baseURL }) => {
  await injectTestSession(context, { id: fixtures.portalUser.id, email: fixtures.portalUser.email }, baseURL!);
  const page = await context.newPage();

  // A same-origin path is not enough here — sanitizePortalRedirectPath
  // additionally requires the result stay under /portal, so a portal
  // identity can never be redirected into the staff dashboard.
  await page.goto("/portal/login?redirectTo=%2Fdashboard");
  await expect(page).toHaveURL(/\/portal$/);

  await page.goto("/portal/login?redirectTo=https%3A%2F%2Fevil.example.com");
  await expect(page).toHaveURL(/\/portal$/);
});

test("injected script-like text renders as literal text and never executes", async ({ page, context, baseURL }) => {
  await injectTestSession(context, { id: fixtures.owner.id, email: fixtures.owner.email }, baseURL!);

  const payload = `<script>alert(1)</script> ${fixtures.runId}`;
  let dialogFired = false;
  page.on("dialog", async (dialog) => {
    dialogFired = true;
    await dialog.dismiss();
  });

  try {
    await page.goto("/clients/new");
    // exact: true — the Client form's Billing details subsection (Invoice
    // System Slice 1) added a "Billing legal name" field, making the
    // default substring match for "Name" ambiguous.
    await page.getByRole("textbox", { name: "Name", exact: true }).fill(payload);
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/clients/new") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Create client" }).click(),
    ]);
    await expect(page).toHaveURL(/\/clients(\?|$)/);

    // Rendered as literal, visible text — proves React's default escaping
    // held for real, user-supplied content round-tripped through the DB.
    // Product UI/UX PR 3 gave the Clients list page a second, hidden-below-md
    // rendering of the same row (the mobile stacked-card list) alongside the
    // existing desktop table — this payload therefore now legitimately
    // appears twice in the DOM (one visible at this default desktop
    // viewport, one display:none), which is itself further, incidental
    // proof that escaping holds in both renderings. .first() targets
    // whichever instance the current viewport actually shows; this
    // assertion's own concern (escaped, inert, visible text; never an
    // executable element) is unaffected by which of the two renderings it
    // happens to resolve to.
    await expect(page.getByText(payload, { exact: true }).first()).toBeVisible();
    // Never became an actual executable <script> element anywhere on the page.
    await expect(page.locator("script", { hasText: "alert(1)" })).toHaveCount(0);
    expect(dialogFired).toBe(false);
  } finally {
    await dbQuery("client", "deleteMany", { where: { name: payload } });
  }
});
