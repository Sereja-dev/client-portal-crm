import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import ClientInvitePage from "@/app/portal/invite/[token]/page";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { testEmail } from "../../support/run-id";
import { TEST_EMAIL_DOMAIN } from "../../support/env";
import { setMockAuthUser, resetAuthMock } from "../../support/auth-mock";

/**
 * Portal Invite — Existing Portal User Acceptance Bugfix. Reproduces the
 * exact Production scenario: an authenticated Portal identity that
 * already has a PortalUser row for a *different* Client visits a fresh
 * invitation for *another* Client. Mirrors portal-invite-dual-identity-
 * notice.test.ts's own exact rendering technique (this repo has no
 * @testing-library/react/jsdom).
 *
 * Confirmed root cause (not a transaction/atomicity bug — that part was
 * already correct): acceptClientInvitationAction's own CONFLICTING_PORTAL_
 * USER check deliberately refuses to accept in this case (the MVP Portal
 * identity model is exactly one Client per PortalUser row — see that
 * check's own comment) and previously returned the same generic
 * "This invitation is no longer available." message every other failure
 * also returns, which read as a bug rather than an explained limitation.
 * This fix (a) shows a clear, honest explanation on the page BEFORE the
 * Accept button is ever offered, and (b) gives the same server-side
 * rejection its own distinct message — while leaving the actual
 * accept/reject decision and its atomicity completely unchanged (see
 * test/integration/invitations/concurrent-accept.test.ts for that
 * coverage, untouched by this fix).
 */

const CONFLICT_TEXT = "already has Client Portal access for a different client";

async function createClientInvitation(fixtures: TestFixtures, clientId: string, email: string) {
  return prisma.clientInvitation.create({
    data: {
      clientId,
      email,
      token: randomUUID(),
      status: "PENDING",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      invitedById: fixtures.owner.id,
    },
  });
}

async function renderInvitePage(token: string): Promise<string> {
  const element = await ClientInvitePage({ params: Promise.resolve({ token }) });
  return renderToStaticMarkup(element);
}

describe("Client Portal invite page — conflicting-account denial (Portal Invite Existing User Bugfix)", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(() => {
    resetAuthMock();
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("15/19. an existing Portal account already linked to a different Client sees a clear denial, never the Accept button, and no cross-tenant Client name is leaked", async () => {
    const authUserId = randomUUID();
    const email = testEmail(`portal-conflict-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN, fixtures.runId);
    await prisma.portalUser.create({
      data: { id: authUserId, clientId: fixtures.clientA.id, email, name: "Existing Portal User" },
    });
    // A fresh invitation for a DIFFERENT Client, same email/identity.
    const invitation = await createClientInvitation(fixtures, fixtures.clientB.id, email);
    setMockAuthUser({ id: authUserId, email });

    try {
      const markup = await renderInvitePage(invitation.token);

      expect(markup).toContain(CONFLICT_TEXT);
      expect(markup).toContain("Sign out and use a different account");
      expect(markup).not.toContain("Accept invitation");
      // Never names which other Client this identity already belongs to.
      expect(markup).not.toContain(fixtures.clientA.name);
      // Never leaks internal vocabulary.
      expect(markup.toLowerCase()).not.toContain("portaluser");
      expect(markup.toLowerCase()).not.toContain("clientid");
    } finally {
      await prisma.portalUser.deleteMany({ where: { id: authUserId } });
      await prisma.clientInvitation.deleteMany({ where: { id: invitation.id } });
    }
  });

  it("14. an existing Portal account already linked to the SAME invited Client (idempotent re-invite) still sees the normal Accept form, never the conflict denial", async () => {
    const authUserId = randomUUID();
    const email = testEmail(`portal-sameclient-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN, fixtures.runId);
    await prisma.portalUser.create({
      data: { id: authUserId, clientId: fixtures.clientA.id, email, name: "Existing Portal User" },
    });
    // A fresh invitation for the SAME Client this identity is already
    // linked to (e.g. re-invited by Staff for some other reason).
    const invitation = await createClientInvitation(fixtures, fixtures.clientA.id, email);
    setMockAuthUser({ id: authUserId, email });

    try {
      const markup = await renderInvitePage(invitation.token);

      expect(markup).not.toContain(CONFLICT_TEXT);
      expect(markup).toContain("Accept invitation");
    } finally {
      await prisma.portalUser.deleteMany({ where: { id: authUserId } });
      await prisma.clientInvitation.deleteMany({ where: { id: invitation.id } });
    }
  });

  it("no existing PortalUser at all (brand-new identity) never sees the conflict denial", async () => {
    const email = testEmail(`portal-brandnew-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN, fixtures.runId);
    const invitation = await createClientInvitation(fixtures, fixtures.clientA.id, email);
    setMockAuthUser({ id: randomUUID(), email });

    try {
      const markup = await renderInvitePage(invitation.token);

      expect(markup).not.toContain(CONFLICT_TEXT);
      expect(markup).toContain("Accept invitation");
    } finally {
      await prisma.clientInvitation.deleteMany({ where: { id: invitation.id } });
    }
  });
});
