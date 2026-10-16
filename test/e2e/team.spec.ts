import { randomUUID } from "node:crypto";
import { test, expect, type BrowserContext } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";

type SeededInvitationRow = { id: string; token: string; email: string; expiresAt: string };

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

/**
 * Team expired-invitation UX remediation. Invitation lifecycle stays
 * MODEL A (computed expiry, see the dedicated audit) -- these seed real
 * PENDING rows directly via dbQuery with a controlled expiresAt, exactly
 * like resendInvitationAction's own already-tested backend behavior
 * (test/integration/invitations/lifecycle.test.ts), never a literal
 * EXPIRED status (which no runtime code path ever writes).
 */
test.describe("Team page — invitation expiry UX", () => {
  let expiredInvitation: SeededInvitationRow;
  let liveInvitation: SeededInvitationRow;

  test.beforeAll(async () => {
    expiredInvitation = await dbQuery("invitation", "create", {
      data: {
        organizationId: fixtures.orgA.id,
        email: `expired-invite-${fixtures.runId}@example.com`,
        role: "MEMBER",
        token: randomUUID(),
        status: "PENDING",
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // yesterday
        invitedById: fixtures.owner.id,
      },
    });
    liveInvitation = await dbQuery("invitation", "create", {
      data: {
        organizationId: fixtures.orgA.id,
        email: `live-invite-${fixtures.runId}@example.com`,
        role: "MEMBER",
        token: randomUUID(),
        status: "PENDING",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // in a week
        invitedById: fixtures.owner.id,
      },
    });
  });

  test.afterAll(async () => {
    await dbQuery("invitation", "deleteMany", {
      where: { id: { in: [expiredInvitation.id, liveInvitation.id] } },
    });
  });

  test("OWNER: expired invitation shows the Expired badge, Resend and Cancel remain available, Copy link is hidden", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/team");
    const row = page.getByRole("row", { name: new RegExp(expiredInvitation.email) });
    await expect(row).toBeVisible();
    await expect(row.getByText(new Date(expiredInvitation.expiresAt).toLocaleDateString())).toBeVisible();
    await expect(row.getByText("Expired", { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "Resend" })).toBeVisible();
    await expect(row.getByRole("button", { name: "Cancel" })).toBeVisible();
    await expect(row.getByRole("button", { name: "Copy link" })).toHaveCount(0);
  });

  test("MEMBER: expired invitation shows the Expired badge, with no Copy link, Resend, or Cancel", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAsMember(context, baseURL!, fixtures.member, fixtures.orgA.id);
    await page.goto("/team");
    const row = page.getByRole("row", { name: new RegExp(expiredInvitation.email) });
    await expect(row).toBeVisible();
    await expect(row.getByText("Expired", { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "Copy link" })).toHaveCount(0);
    await expect(row.getByRole("button", { name: "Resend" })).toHaveCount(0);
    await expect(row.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  });

  test("live invitation regression: no Expired badge; OWNER sees Copy link/Resend/Cancel, MEMBER sees Copy link only", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/team");
    const ownerRow = page.getByRole("row", { name: new RegExp(liveInvitation.email) });
    await expect(ownerRow).toBeVisible();
    await expect(ownerRow.getByText("Expired", { exact: true })).toHaveCount(0);
    await expect(ownerRow.getByRole("button", { name: "Copy link" })).toBeVisible();
    await expect(ownerRow.getByRole("button", { name: "Resend" })).toBeVisible();
    await expect(ownerRow.getByRole("button", { name: "Cancel" })).toBeVisible();

    await actAsMember(context, baseURL!, fixtures.member, fixtures.orgA.id);
    await page.goto("/team");
    const memberRow = page.getByRole("row", { name: new RegExp(liveInvitation.email) });
    await expect(memberRow.getByText("Expired", { exact: true })).toHaveCount(0);
    await expect(memberRow.getByRole("button", { name: "Copy link" })).toBeVisible();
    await expect(memberRow.getByRole("button", { name: "Resend" })).toHaveCount(0);
    await expect(memberRow.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  });

  // Runs before the resend test below, which deliberately revives
  // expiredInvitation back to a live state -- this is the last point in
  // the file where that row is reliably still expired.
  test("390px: the Expired badge does not cause page-level horizontal overflow", async ({ context, baseURL, page }) => {
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/team");
    // .last() -- at 390px the desktop table is hidden (`hidden xl:block`);
    // the RecordCard's own "Expired" badge, last in DOM order, is the
    // actually-visible one here (same pattern as this suite's other
    // 390px specs, e.g. test/e2e/quote-saved-views.spec.ts).
    await expect(page.getByText("Expired", { exact: true }).last()).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });

  test("resend on an expired invitation clears the Expired badge and makes a fresh Copy link available", async ({
    context,
    baseURL,
    page,
  }) => {
    await actAsMember(context, baseURL!, fixtures.owner, fixtures.orgA.id);
    await page.goto("/team");
    const row = page.getByRole("row", { name: new RegExp(expiredInvitation.email) });
    await expect(row.getByText("Expired", { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "Copy link" })).toHaveCount(0);

    await row.getByRole("button", { name: "Resend" }).click();
    await expect(row.getByText("Invitation resent.")).toBeVisible();

    // The Expired badge disappears and Copy link reappears in the same
    // row -- the UI transition this remediation exists to prove, driven
    // entirely by the existing resendInvitationAction return-value +
    // revalidatePath("/team") mechanism already established for the
    // token itself (no new client-side expiry state was invented).
    await expect(row.getByText("Expired", { exact: true })).toHaveCount(0);
    await expect(row.getByRole("button", { name: "Copy link" })).toBeVisible();

    // Backend confirmation: the same row's token/expiresAt actually
    // changed (resendInvitationAction's own already-tested semantics —
    // this only proves the UI is reading the real, current row, not a
    // second, independent client-side computation).
    const refreshed = await dbQuery<SeededInvitationRow & { status: string }>("invitation", "findUniqueOrThrow", {
      where: { id: expiredInvitation.id },
    });
    expect(refreshed.status).toBe("PENDING");
    expect(refreshed.token).not.toBe(expiredInvitation.token);
    expect(new Date(refreshed.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });
});
