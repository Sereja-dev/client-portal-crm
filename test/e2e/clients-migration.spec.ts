import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Design System page migration Batch 9 — Remaining Clients surfaces
 * (/clients/new, /clients/[id]/edit, ClientForm, staff-only Client
 * Portal Access). Covers this batch's own critical gates: real Dark
 * computed-style checks for the migrated card surfaces, the Portal
 * Access section's readability, and action-wiring invariants for the
 * staff-only invite/resend/cancel/remove controls (opened, never
 * confirmed, so nothing is actually mutated) — plus mobile no-overflow.
 * Full create/edit/delete and Portal invitation acceptance behavior is
 * already exhaustively covered by test/e2e/staff-app.spec.ts and
 * test/e2e/portal-invite.spec.ts — deliberately not repeated here.
 */

let fixtures: TestFixtures;

async function actAsOwner(context: BrowserContext, baseURL: string): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, fixtures.owner, baseURL);
  await context.addCookies([
    {
      name: "active_organization_id",
      value: fixtures.orgA.id,
      domain: new URL(baseURL).hostname,
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

test.describe("Design System Batch 9 — Remaining Clients surfaces", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test.beforeEach(async ({ context, baseURL }) => {
    await dbQuery("user", "update", { where: { id: fixtures.owner.id }, data: { themeMode: "DARK" } });
    await actAsOwner(context, baseURL!);
  });

  test("Dark: /clients/new card is opaque, heading/Cancel readable, no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("/clients/new");
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");

    const heading = page.getByRole("heading", { name: "Add client", level: 1 });
    await expect(heading).toBeVisible();
    await expect.poll(() => heading.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(236, 237, 238)");

    // The card surface is the <div> wrapping <ClientForm>, not the <form>
    // element itself (which only ever gets "space-y-4") — from the
    // "Billing details" legend, up three levels reaches it (legend ->
    // fieldset -> form -> card div). Also avoids React's own hidden
    // progressive-enhancement safety-net <form>, which duplicate-matches
    // any plain `page.locator("form")` query. filter({ visible: true })
    // keeps this scoped to the one real, on-screen legend even if a
    // route ever grows a route-segment loading.tsx (see the /edit test
    // below's own comment) — the invisible streaming-staging duplicate
    // that would introduce is never what a user actually sees.
    const cardDiv = page.getByText("Billing details", { exact: true }).filter({ visible: true }).locator("../../..");
    await expect.poll(() => cardDiv.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(27, 31, 38)");

    expect(errors).toEqual([]);
  });

  test("Dark: /clients/[id]/edit card, Portal Access section, and attachments are opaque with no console errors", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`/clients/${fixtures.clientA.id}/edit`);
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");

    // This route has its own loading.tsx, so Next.js streams it: for a
    // short window after navigation, the real "Billing details" card
    // coexists in the DOM with an invisible <div hidden id="S:N"> staging
    // copy of the same content (React's out-of-order Suspense-boundary
    // replacement protocol, mid-swap) — never a second copy a user can
    // actually see. A bare getByText(...) matches DOM text regardless of
    // visibility, so it can catch that staging copy too and strict-mode-
    // violate; filter({ visible: true }) keeps this scoped to the one
    // real, on-screen card.
    const cardDiv = page.getByText("Billing details", { exact: true }).filter({ visible: true }).locator("../../..");
    await expect.poll(() => cardDiv.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(27, 31, 38)");

    // Portal Access section — existing portal user (fixtures.portalUser)
    // and pending invitation (fixtures.clientInvitation) both render by
    // default from the fixture graph.
    const portalHeading = page.getByRole("heading", { name: "Client Portal access" });
    await expect(portalHeading).toBeVisible();
    await expect.poll(() => portalHeading.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(236, 237, 238)");
    // Same streaming-staging duplicate as the "Billing details" card
    // above, just on a different (later-resolving) Suspense boundary —
    // reaching this check sooner after navigation (now that the Billing
    // details check above no longer stalls on its own strict-mode
    // violation) lands squarely inside this boundary's own still-active
    // streaming window. Same fix, same reasoning: filter to the one
    // real, on-screen row.
    await expect(page.getByText(fixtures.portalUser.email).filter({ visible: true })).toBeVisible();

    // Attachments passive regression — already-migrated shared component,
    // still opaque/readable in Dark when consumed from this page.
    const attachmentsHeading = page.getByRole("heading", { name: "Attachments" });
    await expect(attachmentsHeading).toBeVisible();
    await expect
      .poll(() => attachmentsHeading.evaluate((el) => getComputedStyle(el).color))
      .toBe("rgb(236, 237, 238)");

    expect(errors).toEqual([]);
  });

  test("Action-wiring invariant: Copy link preserves the real invite URL, and Cancel/Remove open their real confirm dialogs without mutating anything", async ({
    page,
  }) => {
    await page.goto(`/clients/${fixtures.clientA.id}/edit`);

    // Copy link — grant clipboard permission and verify the exact copied
    // value, not just that a click "worked".
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    const pendingRow = page.getByText(fixtures.clientInvitation.email).locator("../..");
    await pendingRow.getByRole("button", { name: "Copy link" }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(`${new URL(page.url()).origin}/portal/invite/${fixtures.clientInvitation.token}`);

    // Cancel invitation — opens the real ConfirmDialog with the correct
    // email in its description; dismissed via Escape, never confirmed, so
    // the invitation is never actually canceled.
    const beforeInvitations = await dbQuery("clientInvitation", "count", { where: { clientId: fixtures.clientA.id, status: "PENDING" } });
    await pendingRow.getByRole("button", { name: "Cancel" }).click();
    const cancelDialog = page.getByRole("dialog", { name: "Cancel invitation" });
    await expect(cancelDialog).toBeVisible();
    await expect(cancelDialog.getByText(fixtures.clientInvitation.email)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(cancelDialog).not.toBeVisible();

    // Remove portal access — same open-without-confirm proof for the
    // existing PortalUser row.
    const userRow = page.getByText(fixtures.portalUser.email).locator("../..");
    await userRow.getByRole("button", { name: "Remove access" }).click();
    const removeDialog = page.getByRole("dialog", { name: "Remove portal access" });
    await expect(removeDialog).toBeVisible();
    await expect(removeDialog.getByText(fixtures.portalUser.name, { exact: false })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(removeDialog).not.toBeVisible();

    const afterInvitations = await dbQuery("clientInvitation", "count", { where: { clientId: fixtures.clientA.id, status: "PENDING" } });
    expect(afterInvitations).toBe(beforeInvitations);
    const portalUserStillExists = await dbQuery("portalUser", "count", { where: { id: fixtures.portalUser.id } });
    expect(portalUserStillExists).toBe(1);
  });

  test("Mobile (390/320px): /clients/new and /clients/[id]/edit fit viewport with no horizontal overflow", async ({
    page,
  }) => {
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 900 });

      await page.goto("/clients/new");
      await expect(page.getByRole("heading", { name: "Add client", level: 1 })).toBeVisible();
      let overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

      await page.goto(`/clients/${fixtures.clientA.id}/edit`);
      await expect(page.getByRole("heading", { name: "Client Portal access" })).toBeVisible();
      overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    }
  });
});
