import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { seedE2EFixtures, cleanupTestData, dbQuery, type TestFixtures } from "./fixtures";
import { injectTestSession } from "../support/e2e-session";
import { testEmail } from "../support/run-id";
import { TEST_EMAIL_DOMAIN } from "../support/env";

/**
 * Client Portal Audit Finding 3 — `/portal/invite/[token]` had integration
 * coverage for its Server Action (test/integration/portal/invitation-
 * acceptance-login.test.ts, test/integration/invitations/concurrent-
 * accept.test.ts) but no E2E test drove the real page/browser flow.
 *
 * Implementation-pattern reference: test/e2e/invitation.spec.ts (the
 * staff `/invite/[token]` flow) — same injectTestSession()-before-
 * navigate technique, since neither flow has real Supabase Auth to sign
 * in against locally. Not blindly copied: the Portal flow's page has
 * materially different states (an expired-token card, an already-
 * accepted card with a conditional "Go to portal" link, an identity-
 * mismatch sign-out branch) that the staff page doesn't have, and never
 * touches User/Organization/Membership at all — only PortalUser +
 * Activity, which is what every mutation proof below checks.
 *
 * Unlike Finding 2 (Portal signup), TEST_MODE's Supabase stub already
 * fully supports this flow: acceptClientInvitationAction only ever calls
 * supabase.auth.getUser() (stubbed — reads the injected test-identity
 * cookie), never signUp/signInWithPassword. The full successful-
 * acceptance path is therefore genuinely exercised below, not skipped.
 *
 * Not covered, deliberately: a bare `/portal/invite/` with no token
 * segment at all doesn't match this `[token]` dynamic route — Next.js's
 * own framework-level 404 applies, not any behavior this page's source
 * promises, so it isn't a meaningful assertion surface here. A
 * malformed token string and a well-formed-but-nonexistent one hit the
 * identical `findUnique` miss and the identical "Invitation not found"
 * branch — tested once, as one case, not twice. No dedicated rate-limit
 * test is added: ACCEPT_PORTAL_INVITE_LIMIT is 20 per hour, comfortably
 * unreached by this file's own handful of real submissions, and it
 * isn't part of this Finding's required scenario list.
 */

let fixtures: TestFixtures;

test.beforeAll(async () => {
  fixtures = await seedE2EFixtures();
});

test.afterAll(async () => {
  await cleanupTestData(fixtures);
});

test.describe("Portal invite — invalid/terminal token states (no session)", () => {
  test("a malformed or nonexistent token shows the generic not-found card, discloses nothing, and mutates nothing", async ({ page }) => {
    const bogusToken = `not-a-real-token-${randomUUID()}`;
    const before = await dbQuery("portalUser", "count", {});

    await page.goto(`/portal/invite/${bogusToken}`);

    await expect(page.getByRole("heading", { name: "Invitation not found" })).toBeVisible();
    await expect(page.getByText("Invitation not found or no longer available.")).toBeVisible();
    // Bounded — the generic card must never leak the bogus token, any
    // client name, or any email back into the page.
    await expect(page.getByText(bogusToken)).toHaveCount(0);
    await expect(page.getByText(fixtures.clientA.name)).toHaveCount(0);

    const after = await dbQuery("portalUser", "count", {});
    expect(after).toBe(before);
  });

  test("an expired invitation shows the expired card, with no client/email disclosure, and mutates nothing", async ({ page }) => {
    const email = testEmail("portal-invite-expired", TEST_EMAIL_DOMAIN, fixtures.runId);
    const invitation = await dbQuery<{ id: string; token: string }>("clientInvitation", "create", {
      data: {
        clientId: fixtures.clientA.id,
        email,
        token: randomUUID(),
        status: "PENDING",
        expiresAt: new Date(Date.now() - 60_000),
        invitedById: fixtures.owner.id,
      },
    });

    try {
      const before = await dbQuery("portalUser", "count", {});
      await page.goto(`/portal/invite/${invitation.token}`);

      await expect(page.getByRole("heading", { name: "Invitation expired" })).toBeVisible();
      await expect(page.getByText("This invitation has expired.")).toBeVisible();
      // The page's own expired-state branch never renders the client
      // name or invited email at all (confirmed from source) — the
      // strongest available disclosure proof for this exact state.
      await expect(page.getByText(fixtures.clientA.name)).toHaveCount(0);
      await expect(page.getByText(email)).toHaveCount(0);

      const after = await dbQuery("portalUser", "count", {});
      expect(after).toBe(before);
      const stillPending = await dbQuery<{ status: string }>("clientInvitation", "findUniqueOrThrow", {
        where: { id: invitation.id },
      });
      expect(stillPending.status).toBe("PENDING");
    } finally {
      await dbQuery("clientInvitation", "deleteMany", { where: { id: invitation.id } });
    }
  });

  test("an already-accepted invitation shows the accepted card with no session, and no 'Go to portal' link", async ({ page }) => {
    const email = testEmail("portal-invite-accepted", TEST_EMAIL_DOMAIN, fixtures.runId);
    const invitation = await dbQuery<{ id: string; token: string }>("clientInvitation", "create", {
      data: {
        clientId: fixtures.clientA.id,
        email,
        token: randomUUID(),
        status: "ACCEPTED",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        invitedById: fixtures.owner.id,
      },
    });

    try {
      await page.goto(`/portal/invite/${invitation.token}`);
      await expect(page.getByRole("heading", { name: "Invitation already accepted" })).toBeVisible();
      await expect(page.getByText(fixtures.clientA.name, { exact: false })).toBeVisible();
      // No authenticated identity at all here, so the page can never
      // know this visitor "is" the accepter — the link must be absent.
      await expect(page.getByRole("link", { name: "Go to portal" })).toHaveCount(0);
    } finally {
      await dbQuery("clientInvitation", "deleteMany", { where: { id: invitation.id } });
    }
  });
});

test.describe("Portal invite — valid pending token", () => {
  test("no session: shows client/invited-email/expiry and Client Portal login + Sign up links, no Accept control", async ({ page }) => {
    const email = testEmail("portal-invite-nosession", TEST_EMAIL_DOMAIN, fixtures.runId);
    const invitation = await dbQuery<{ id: string; token: string }>("clientInvitation", "create", {
      data: {
        clientId: fixtures.clientA.id,
        email,
        token: randomUUID(),
        status: "PENDING",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        invitedById: fixtures.owner.id,
      },
    });

    try {
      await page.goto(`/portal/invite/${invitation.token}`);
      await expect(page.getByRole("heading", { name: "You're invited" })).toBeVisible();
      await expect(page.getByText(fixtures.clientA.name, { exact: false })).toBeVisible();
      await expect(page.getByText(email, { exact: false })).toBeVisible();

      const redirectTarget = `/portal/invite/${invitation.token}`;
      const loginLink = page.getByRole("link", { name: "Client Portal login" });
      await expect(loginLink).toBeVisible();
      await expect(loginLink).toHaveAttribute("href", `/portal/login?redirectTo=${encodeURIComponent(redirectTarget)}`);
      const signupLink = page.getByRole("link", { name: "Sign up" });
      await expect(signupLink).toBeVisible();
      // Portal signup-confirmation defect fix: the Sign up link now also
      // carries invitationToken, so /portal/signup can server-validate
      // and prefill/lock the invited email — see resolveValidPortalSignupInvitation.
      await expect(signupLink).toHaveAttribute(
        "href",
        `/portal/signup?invitationToken=${encodeURIComponent(invitation.token)}&redirectTo=${encodeURIComponent(redirectTarget)}`,
      );

      await expect(page.getByRole("button", { name: "Accept invitation" })).toHaveCount(0);
    } finally {
      await dbQuery("clientInvitation", "deleteMany", { where: { id: invitation.id } });
    }
  });

  test("mismatched identity: shows both email addresses and a sign-out control, no Accept control, no mutation", async ({
    page,
    context,
    baseURL,
  }) => {
    const invitedEmail = testEmail("portal-invite-invited", TEST_EMAIL_DOMAIN, fixtures.runId);
    const wrongIdentityId = randomUUID();
    const wrongIdentityEmail = testEmail("portal-invite-wrong", TEST_EMAIL_DOMAIN, fixtures.runId);
    const invitation = await dbQuery<{ id: string; token: string }>("clientInvitation", "create", {
      data: {
        clientId: fixtures.clientA.id,
        email: invitedEmail,
        token: randomUUID(),
        status: "PENDING",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        invitedById: fixtures.owner.id,
      },
    });

    try {
      await injectTestSession(context, { id: wrongIdentityId, email: wrongIdentityEmail }, baseURL!);
      await page.goto(`/portal/invite/${invitation.token}`);

      await expect(page.getByRole("heading", { name: "You're invited" })).toBeVisible();
      // The invited email legitimately renders twice in this exact state
      // — the persistent "Invited email:" info block (always shown) plus
      // its own repetition inside the mismatch explanation itself
      // ("sent to X, but you're signed in as Y") — confirmed directly
      // from source, not a locator bug. Asserting the exact count proves
      // this precisely rather than picking one arbitrarily.
      await expect(page.getByText(invitedEmail, { exact: false })).toHaveCount(2);
      await expect(page.getByText(wrongIdentityEmail, { exact: false })).toBeVisible();
      await expect(page.getByRole("button", { name: "Sign out and log in with the right account" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Accept invitation" })).toHaveCount(0);

      const stillPending = await dbQuery<{ status: string }>("clientInvitation", "findUniqueOrThrow", {
        where: { id: invitation.id },
      });
      expect(stillPending.status).toBe("PENDING");
      const portalUser = await dbQuery("portalUser", "findUnique", { where: { id: wrongIdentityId } });
      expect(portalUser).toBeNull();
    } finally {
      await dbQuery("clientInvitation", "deleteMany", { where: { id: invitation.id } });
    }
  });
});

test.describe("Portal invite — successful acceptance and idempotent repeat", () => {
  test("accepting creates exactly one PortalUser and one Activity row, redirects to /portal, leaves a control invitation untouched, and re-visiting shows a stable already-accepted state with no second mutation", async ({
    page,
    context,
    baseURL,
  }) => {
    const acceptedIdentityId = randomUUID();
    const email = testEmail("portal-invite-accept", TEST_EMAIL_DOMAIN, fixtures.runId);
    const invitation = await dbQuery<{ id: string; token: string }>("clientInvitation", "create", {
      data: {
        clientId: fixtures.clientA.id,
        email,
        token: randomUUID(),
        status: "PENDING",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        invitedById: fixtures.owner.id,
      },
    });
    // Isolation control: a second, unrelated PENDING invitation for a
    // different Client, which must remain completely untouched by this
    // test's own accept flow.
    const controlEmail = testEmail("portal-invite-control", TEST_EMAIL_DOMAIN, fixtures.runId);
    const controlInvitation = await dbQuery<{ id: string; token: string }>("clientInvitation", "create", {
      data: {
        clientId: fixtures.clientB.id,
        email: controlEmail,
        token: randomUUID(),
        status: "PENDING",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        invitedById: fixtures.orgBOwner.id,
      },
    });

    try {
      await injectTestSession(context, { id: acceptedIdentityId, email }, baseURL!);
      await page.goto(`/portal/invite/${invitation.token}`);
      await expect(page.getByRole("heading", { name: "You're invited" })).toBeVisible();

      const acceptButton = page.getByRole("button", { name: "Accept invitation" });
      await expect(acceptButton).toBeVisible();
      await Promise.all([
        page.waitForResponse((r) => r.request().method() === "POST"),
        acceptButton.click(),
      ]);
      await expect(page).toHaveURL(/\/portal$/);

      const portalUser = await dbQuery<{ clientId: string; email: string; lastLoginAt: string | null }>(
        "portalUser",
        "findUniqueOrThrow",
        { where: { id: acceptedIdentityId } },
      );
      expect(portalUser.clientId).toBe(fixtures.clientA.id);
      expect(portalUser.email).toBe(email);
      expect(portalUser.lastLoginAt).not.toBeNull();

      const acceptedInvitation = await dbQuery<{ status: string }>("clientInvitation", "findUniqueOrThrow", {
        where: { id: invitation.id },
      });
      expect(acceptedInvitation.status).toBe("ACCEPTED");

      const activities = await dbQuery<Array<{ entityType: string; entityId: string; action: string }>>("activity", "findMany", {
        where: { entityType: "PORTAL_USER", entityId: acceptedIdentityId },
      });
      expect(activities).toHaveLength(1);
      expect(activities[0].action).toBe("PORTAL_INVITATION_ACCEPTED");

      // No staff Organization/Membership was ever provisioned for this
      // identity — this flow only ever touches PortalUser + Activity.
      const membership = await dbQuery("membership", "findFirst", { where: { userId: acceptedIdentityId } });
      expect(membership).toBeNull();

      // The unrelated control invitation was never touched.
      const controlAfter = await dbQuery<{ status: string }>("clientInvitation", "findUniqueOrThrow", {
        where: { id: controlInvitation.id },
      });
      expect(controlAfter.status).toBe("PENDING");
      const controlPortalUser = await dbQuery("portalUser", "findFirst", { where: { email: controlEmail } });
      expect(controlPortalUser).toBeNull();

      // Repeat navigation with the same accepted identity, still
      // present from the injected session above — must be stable and
      // idempotent, never a second mutation.
      await page.goto(`/portal/invite/${invitation.token}`);
      await expect(page.getByRole("heading", { name: "Invitation already accepted" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Go to portal" })).toBeVisible();

      const portalUserAfterRevisit = await dbQuery<{ lastLoginAt: string | null }>("portalUser", "findUniqueOrThrow", {
        where: { id: acceptedIdentityId },
      });
      expect(portalUserAfterRevisit.lastLoginAt).toBe(portalUser.lastLoginAt);
      const activitiesAfterRevisit = await dbQuery<unknown[]>("activity", "findMany", {
        where: { entityType: "PORTAL_USER", entityId: acceptedIdentityId },
      });
      expect(activitiesAfterRevisit).toHaveLength(1);
    } finally {
      await dbQuery("activity", "deleteMany", { where: { entityType: "PORTAL_USER", entityId: acceptedIdentityId } });
      await dbQuery("portalUser", "deleteMany", { where: { id: acceptedIdentityId } });
      await dbQuery("clientInvitation", "deleteMany", { where: { id: { in: [invitation.id, controlInvitation.id] } } });
    }
  });
});
