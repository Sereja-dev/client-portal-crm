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
 * Dual-identity minimal hardening. The invite page (a Server Component,
 * async) is rendered directly and its resolved JSX passed to
 * renderToStaticMarkup — same technique invoice-issuance-readiness-
 * notice.test.tsx already uses (this repo has no @testing-library/react/
 * jsdom). setMockAuthUser is the same seam
 * portal-invited-signup-flow.test.ts's own "existing-user" describe block
 * already uses for this exact page's sibling Server Action
 * (acceptClientInvitationAction), so this exercises the real,
 * unmocked Prisma-backed `prisma.user.findUnique` this page's own new
 * alreadyStaffAtThisEmail check performs — never a stubbed boolean.
 */

// renderToStaticMarkup HTML-escapes apostrophes as &#x27; — matching the
// same encoded-assertion convention invoice-issuance-readiness-
// notice.test.tsx's own markup checks already use.
const NOTICE_TEXT = "you&#x27;re already signed in with a Staff account at this email";

async function createClientInvitation(fixtures: TestFixtures, overrides: Partial<{ email: string }> = {}) {
  const email = overrides.email ?? testEmail(`portal-invite-notice-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN, fixtures.runId);
  return prisma.clientInvitation.create({
    data: {
      clientId: fixtures.clientA.id,
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

describe("Client Portal invite page — dual-identity notice (minimal hardening)", () => {
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

  it("an already-authenticated Staff user, invited at their own email, sees the notice AND can still accept normally", async () => {
    const invitation = await createClientInvitation(fixtures, { email: fixtures.owner.email });
    setMockAuthUser({ id: fixtures.owner.id, email: fixtures.owner.email });

    const markup = await renderInvitePage(invitation.token);

    expect(markup).toContain(NOTICE_TEXT);
    expect(markup).toContain("Your Staff account won&#x27;t be changed");
    // The accept form itself is still rendered, unconditionally — the
    // notice is additive, never a block.
    expect(markup).toContain("Accept invitation");
    // Never any internal vocabulary in the user-visible copy.
    expect(markup.toLowerCase()).not.toContain("portaluser");
    expect(markup.toLowerCase()).not.toContain("auth uid");
    expect(markup.toLowerCase()).not.toContain("supabase");
  });

  it("an ordinary Portal-only invitee (no Staff User row at all) never sees the notice", async () => {
    const invitation = await createClientInvitation(fixtures);
    // A brand-new auth identity with no User row anywhere — the ordinary,
    // ungated Portal-only case.
    setMockAuthUser({ id: randomUUID(), email: invitation.email });

    const markup = await renderInvitePage(invitation.token);

    expect(markup).not.toContain(NOTICE_TEXT);
    expect(markup).toContain("Accept invitation");
  });

  it("an unauthenticated visitor sees the existing login/signup choice, unchanged, and never the notice", async () => {
    const invitation = await createClientInvitation(fixtures);
    setMockAuthUser(null);

    const markup = await renderInvitePage(invitation.token);

    expect(markup).not.toContain(NOTICE_TEXT);
    expect(markup).toContain("Client Portal login");
    expect(markup).toContain("Sign up");
    expect(markup).not.toContain("Accept invitation");
  });

  it("an authenticated identity whose email doesn't match the invitation still sees the existing mismatch screen, never the notice or the accept form — even when that identity is also Staff", async () => {
    const invitation = await createClientInvitation(fixtures);
    // fixtures.owner's email deliberately does not match this fresh
    // invitation's own random email — proves the pre-existing email-match
    // gate still runs first, and is completely unaffected by this
    // identity also having a Staff User row.
    setMockAuthUser({ id: fixtures.owner.id, email: fixtures.owner.email });

    const markup = await renderInvitePage(invitation.token);

    expect(markup).not.toContain(NOTICE_TEXT);
    expect(markup).not.toContain("Accept invitation");
    expect(markup).toContain("Sign out and log in with the right account");
  });
});
