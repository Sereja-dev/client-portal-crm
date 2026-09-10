import { test, expect } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

// A. Staff application — session injection (see test/support/e2e-session.ts
// and src/lib/test-mode.ts for why: no real Supabase Auth is available
// locally), dashboard access, sidebar navigation, a real Client create →
// edit → delete cycle through the actual UI/Server Actions, the dashboard
// metric reacting to that, and logout / no-session redirect.

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

test.beforeEach(async ({ context, baseURL }) => {
  await injectTestSession(context, { id: fixtures.owner.id, email: fixtures.owner.email }, baseURL!);
});

test("dashboard opens for an injected staff session", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible();
});

test("sidebar shows the product wordmark from the central branding config, not a hardcoded string", async ({ page }) => {
  await page.goto("/dashboard");
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav.getByText("Aqenra", { exact: true })).toBeVisible();
});

/**
 * Aqenra brand PR 2 — real, browser-computed proof that the active nav
 * item renders the approved Aqenra Indigo accent (#2E2A6B = rgb(46, 42,
 * 107)) rather than the old bg-black. A computed-style assertion, not a
 * class-name/snapshot check — genuinely fails if the accent token ever
 * silently resolves to the wrong color or reverts to black.
 */
test("sidebar active navigation item uses the Aqenra accent color, not the old black", async ({ page }) => {
  await page.goto("/dashboard");
  const nav = page.getByRole("navigation", { name: "Primary" });
  const activeLink = nav.getByRole("link", { name: "Dashboard" });
  await expect(activeLink).toHaveCSS("background-color", "rgb(46, 42, 107)");
});

test("sidebar navigation reaches every staff section", async ({ page }) => {
  await page.goto("/dashboard");
  const nav = page.getByRole("navigation", { name: "Primary" });

  for (const [label, path] of [
    ["Clients", "/clients"],
    ["Projects", "/projects"],
    ["Tasks", "/tasks"],
    ["Invoices", "/invoices"],
    ["Team", "/team"],
    ["Activity", "/activity"],
  ] as const) {
    await nav.getByRole("link", { name: label }).click();
    await expect(page).toHaveURL(new RegExp(path.replace("/", "\\/")));
  }
});

test("Client create → edit → delete works end to end, and the dashboard metric reflects it", async ({ page }) => {
  // Stability Correction F3 (hardening against an observed CI flake, not
  // locally reproduced — see this PR's own body for the full bounded
  // stress-run evidence): this is the single most operation-heavy test in
  // this file — six sequential real navigation/Server-Action/DB round
  // trips in one test — so it is the one most exposed to the *cumulative*
  // effect of constrained CI CPU squeezing the default per-test budget.
  // This raises only this one test's own budget; it does not touch
  // playwright.config.ts's global `timeout`.
  test.setTimeout(60_000);
  await page.goto("/dashboard");
  const totalClientsCard = page.getByRole("link", { name: /total clients/i });
  const before = Number((await totalClientsCard.locator("p").nth(1).innerText()).trim());

  // Create.
  await page.goto("/clients/new");
  const clientName = `E2E Test Client ${fixtures.runId}`;
  // exact: true — the Client form's Billing details subsection (Invoice
  // System Slice 1) added a "Billing legal name" field, making the
  // default substring match for "Name" ambiguous.
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(clientName);
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/clients/new") && r.request().method() === "POST"),
    page.getByRole("button", { name: "Create client" }).click(),
  ]);
  await expect(page).toHaveURL(/\/clients(\?|$)/);

  const createdRow = page.getByRole("row", { name: new RegExp(clientName) });
  await expect(createdRow).toBeVisible();

  const created = await dbQuery<{ id: string }>("client", "findFirstOrThrow", { where: { name: clientName } });

  try {
    // Dashboard metric increased by exactly one.
    await page.goto("/dashboard");
    const after = Number((await totalClientsCard.locator("p").nth(1).innerText()).trim());
    expect(after).toBe(before + 1);

    // Edit.
    await page.goto("/clients");
    await createdRow.getByRole("link", { name: "Edit" }).click();
    await expect(page).toHaveURL(new RegExp(`/clients/${created.id}/edit`));
    // Stability Correction F3: `toHaveURL` above only proves the client-
    // side URL changed, not that the edit page's own async Server
    // Component (a real Prisma fetch) has finished rendering the form —
    // this explicit checkpoint is the real readiness signal that was
    // previously only implicit inside `.fill()`'s own auto-wait, given a
    // named, generous, bounded timeout under constrained CI CPU.
    const nameField = page.getByRole("textbox", { name: "Name", exact: true });
    await expect(nameField).toBeVisible({ timeout: 15_000 });
    const updatedName = `${clientName} (updated)`;
    await nameField.fill(updatedName);
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST"),
      page.getByRole("button", { name: "Save changes" }).click(),
    ]);
    const updated = await dbQuery<{ name: string }>("client", "findUniqueOrThrow", { where: { id: created.id } });
    expect(updated.name).toBe(updatedName);

    // Delete (real confirmation dialog).
    await page.goto("/clients");
    const updatedRow = page.getByRole("row", { name: new RegExp(updatedName.replace(/[().]/g, "\\$&")) });
    await updatedRow.getByRole("button", { name: "Delete" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST"),
      dialog.getByRole("button", { name: "Delete" }).click(),
    ]);

    const gone = await dbQuery("client", "findUnique", { where: { id: created.id } });
    expect(gone).toBeNull();

    // Dashboard metric back to its original value.
    await page.goto("/dashboard");
    const restored = Number((await totalClientsCard.locator("p").nth(1).innerText()).trim());
    expect(restored).toBe(before);
  } finally {
    // If an assertion above throws, the client this test created would
    // otherwise survive into afterAll's cleanupTestData — which only
    // targets the originally-seeded fixture IDs — and then block deleting
    // the owning User via Client_userId_fkey's RESTRICT, breaking every
    // later test's seed/cleanup in the same run.
    await dbQuery("client", "deleteMany", { where: { id: created.id } });
  }
});

test("sign out clears the session, and dashboard then redirects to /login", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("visiting a protected page with no session redirects to /login", async ({ context, baseURL }) => {
  // A fresh context with no injected session at all.
  const freshContext = await context.browser()!.newContext();
  const freshPage = await freshContext.newPage();
  await freshPage.goto(`${baseURL}/dashboard`);
  await expect(freshPage).toHaveURL(/\/login/);
  await freshContext.close();
});
