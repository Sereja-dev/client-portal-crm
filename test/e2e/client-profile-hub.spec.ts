import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Client Profile Hub V1 — the new canonical `/clients/[id]` profile
 * route: header/quick actions, tab navigation (including safe fallback
 * for an unknown `?tab=`), tenant isolation (a foreign-org id behaves
 * exactly like every other Staff-scoped route's own notFound()), role
 * gating for the Portal invite quick action, list-page navigation
 * (Name -> profile, Edit -> /edit unchanged), and a narrow-viewport
 * no-overflow check across the header/tabs/one populated tab. Per-
 * section deep coverage (Contacts/Attachments/Portal/Timeline
 * interaction paths) is already exhaustively covered by their own
 * existing E2E specs — deliberately not repeated here.
 */

let fixtures: TestFixtures;

async function actAs(
  context: BrowserContext,
  baseURL: string,
  identity: { id: string; email: string },
  organizationId: string,
): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, identity, baseURL);
  await context.addCookies([
    {
      name: "active_organization_id",
      value: organizationId,
      domain: new URL(baseURL).hostname,
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

test.describe("Client Profile Hub", () => {
  test.beforeAll(async () => {
    fixtures = await seedE2EFixtures();
    // seedE2EFixtures() always seeds one pending ClientInvitation for
    // clientA (fixtures.clientInvitation) -- removed once, here, so the
    // Portal Access pending-invitations tests below can rely on clientA's
    // own genuine "zero pending invitations" state, mirroring Team's own
    // identical precedent (test/e2e/team.spec.ts) for the same class of
    // fixture. No test in this file exercises the populated-invitation-
    // row rendering path (that path is unchanged and already covered
    // elsewhere), so this row is never needed.
    await dbQuery("clientInvitation", "delete", { where: { id: fixtures.clientInvitation.id } });
  });

  test.afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  test("own-org Client: header, quick actions, and every tab link are visible; Overview is the default tab", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto(`/clients/${fixtures.clientA.id}`);

    await expect(page.getByRole("heading", { name: fixtures.clientA.name, level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit client" })).toHaveAttribute(
      "href",
      `/clients/${fixtures.clientA.id}/edit`,
    );

    for (const label of ["Create project", "Create invoice", "Create quote", "Add contact", "Invite to portal"]) {
      await expect(page.getByRole("link", { name: label })).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "Create project" })).toHaveAttribute(
      "href",
      `/projects/new?clientId=${fixtures.clientA.id}`,
    );
    await expect(page.getByRole("link", { name: "Create invoice" })).toHaveAttribute(
      "href",
      `/invoices/new?clientId=${fixtures.clientA.id}`,
    );
    await expect(page.getByRole("link", { name: "Create quote" })).toHaveAttribute(
      "href",
      `/quotes/new?clientId=${fixtures.clientA.id}`,
    );

    for (const tab of ["Overview", "Contacts", "Projects", "Tasks", "Invoices", "Quotes", "Contracts", "Files", "Activity"]) {
      await expect(page.getByRole("link", { name: tab })).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
  });

  test("an unknown ?tab= value falls back to Overview, never a blank or error page", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto(`/clients/${fixtures.clientA.id}?tab=not-a-real-tab`);

    await expect(page.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("Unpaid invoices")).toBeVisible();
  });

  test("a foreign-org Client id renders the same Staff-scoped not-found boundary as every other route", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto(`/clients/${fixtures.clientB.id}`);

    await expect(page.getByText("Page not found")).toBeVisible();
  });

  test("MEMBER never sees the Invite to portal quick action; OWNER does", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.member, fixtures.orgA.id);
    await page.goto(`/clients/${fixtures.clientA.id}`);
    await expect(page.getByRole("link", { name: "Invite to portal" })).toHaveCount(0);
    // The rest of the profile is still readable for MEMBER — ordinary
    // relationship data, not a privileged surface.
    await expect(page.getByRole("heading", { name: fixtures.clientA.name, level: 1 })).toBeVisible();

    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto(`/clients/${fixtures.clientA.id}`);
    await expect(page.getByRole("link", { name: "Invite to portal" })).toBeVisible();
  });

  test("Portal Access pending-invitations empty state: OWNER sees the actionable copy and the Invite form", async ({
    context,
    baseURL,
    page,
  }) => {
    // The file-level beforeAll above already removed clientA's one
    // seeded pending ClientInvitation, so clientA is at zero pending
    // invitations here.
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto(`/clients/${fixtures.clientA.id}`);

    // exact: true -- "No pending invitations" (the title) is otherwise an
    // ambiguous case-insensitive substring match against the MEMBER-only
    // description's own "There are no pending invitations right now."
    await expect(page.getByText("No pending invitations", { exact: true })).toBeVisible();
    await expect(page.getByText("Invite a contact below to give them portal access.")).toBeVisible();
    await expect(page.getByText("There are no pending invitations right now.")).not.toBeVisible();
    await expect(page.getByRole("heading", { name: "Invite a contact" })).toBeVisible();
  });

  test("Portal Access pending-invitations empty state: MEMBER sees neutral copy, no actionable copy, no Invite form", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.member, fixtures.orgA.id);
    await page.goto(`/clients/${fixtures.clientA.id}`);

    await expect(page.getByText("No pending invitations", { exact: true })).toBeVisible();
    await expect(page.getByText("There are no pending invitations right now.")).toBeVisible();
    await expect(page.getByText("Invite a contact below to give them portal access.")).not.toBeVisible();
    await expect(page.getByRole("heading", { name: "Invite a contact" })).toHaveCount(0);
  });

  test("Clients list: the Name link opens the profile, the Edit link is unchanged", async ({ context, baseURL, page }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/clients");

    const row = page.getByRole("row", { name: new RegExp(fixtures.clientA.name) });
    await expect(row.getByRole("link", { name: fixtures.clientA.name })).toHaveAttribute(
      "href",
      `/clients/${fixtures.clientA.id}`,
    );
    await expect(row.getByRole("link", { name: "Edit" })).toHaveAttribute("href", `/clients/${fixtures.clientA.id}/edit`);
  });

  test("390px: header, quick actions, and tabs render with no horizontal overflow, on both Overview and the Contacts tab", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAs(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.setViewportSize({ width: 390, height: 900 });

    await page.goto(`/clients/${fixtures.clientA.id}`);
    await expect(page.getByRole("heading", { name: fixtures.clientA.name, level: 1 })).toBeVisible();
    let overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

    // Quick actions and the tab strip each wrap/scroll independently
    // rather than forcing the page itself to widen.
    await expect(page.getByRole("link", { name: "Create project" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Contacts" })).toBeVisible();

    await page.getByRole("link", { name: "Contacts" }).click();
    await expect(page).toHaveURL(new RegExp(`tab=contacts`));
    await expect(page.getByRole("heading", { name: "Contacts", level: 2 })).toBeVisible();
    overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

    // No duplicate-interactive-id regression: the header's own "Add
    // contact" quick action and the Contacts tab's own "Add contact"
    // trigger must never both render as competing controls with the
    // same accessible name in an ambiguous way once actually on this tab
    // — exactly one real "Add contact" button is present here.
    await expect(page.getByRole("button", { name: "Add contact" })).toHaveCount(1);
  });
});
