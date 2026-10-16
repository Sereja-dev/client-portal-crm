import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

/**
 * Team pending-invitations empty-state copy remediation. Real-browser
 * coverage for the one role-aware string this fix introduces — not a
 * general Team page suite (role-change/removal/ownership-transfer
 * behavior is out of scope here and untouched by this change).
 */

async function setActiveOrg(context: BrowserContext, baseURL: string, organizationId: string): Promise<void> {
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

async function actAsMember(
  context: BrowserContext,
  baseURL: string,
  user: { id: string; email: string },
  organizationId: string,
): Promise<void> {
  await context.clearCookies();
  await injectTestSession(context, user, baseURL);
  await setActiveOrg(context, baseURL, organizationId);
}

let fixtures: TestFixtures;

test.beforeAll(async () => {
  fixtures = await seedE2EFixtures();
  // seedTestData() always seeds exactly one pending staff Invitation for
  // orgA (fixtures.invitation) -- removed once, here, so every test in
  // this file can rely on orgA's own genuine "zero pending invitations"
  // state without re-deriving it per test. No test below exercises the
  // populated-invitation-row rendering path at all (that path is
  // unchanged by this remediation and already has its own coverage
  // elsewhere), so this row is never needed.
  await dbQuery("invitation", "delete", { where: { id: fixtures.invitation.id } });
});

test.afterAll(async () => {
  await cleanupTestData(fixtures);
});

test.describe("Team page — pending invitations empty state", () => {
  test("OWNER sees the actionable copy and the Invite-a-member section", async ({ context, baseURL, page }) => {
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/team");
    // exact: true -- "No pending invitations" (the title) is otherwise an
    // ambiguous case-insensitive substring match against the MEMBER-only
    // description's own "There are no pending invitations right now."
    await expect(page.getByText("No pending invitations", { exact: true })).toBeVisible();
    await expect(page.getByText("Invite someone below to add them to your organization.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Invite a member" })).toBeVisible();
    await expect(page.getByText("There are no pending invitations right now.")).not.toBeVisible();
  });

  test("ADMIN sees the identical actionable copy and the Invite-a-member section", async ({ context, baseURL, page }) => {
    await actAsMember(context, baseURL!, fixtures.admin, fixtures.orgA.id);
    await page.goto("/team");
    // exact: true -- "No pending invitations" (the title) is otherwise an
    // ambiguous case-insensitive substring match against the MEMBER-only
    // description's own "There are no pending invitations right now."
    await expect(page.getByText("No pending invitations", { exact: true })).toBeVisible();
    await expect(page.getByText("Invite someone below to add them to your organization.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Invite a member" })).toBeVisible();
  });

  test("MEMBER sees neutral copy, never the actionable text, and no Invite-a-member section", async ({ context, baseURL, page }) => {
    await actAsMember(context, baseURL!, fixtures.member, fixtures.orgA.id);
    await page.goto("/team");
    // exact: true -- "No pending invitations" (the title) is otherwise an
    // ambiguous case-insensitive substring match against the MEMBER-only
    // description's own "There are no pending invitations right now."
    await expect(page.getByText("No pending invitations", { exact: true })).toBeVisible();
    await expect(page.getByText("There are no pending invitations right now.")).toBeVisible();
    await expect(page.getByText("Invite someone below to add them to your organization.")).not.toBeVisible();
    await expect(page.getByRole("heading", { name: "Invite a member" })).not.toBeVisible();
  });
});
