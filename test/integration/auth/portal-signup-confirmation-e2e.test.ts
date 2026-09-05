import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { portalSignup } from "@/app/portal/signup/actions";
import { acceptClientInvitationAction } from "@/app/portal/invite/[token]/actions";
import { GET as confirmGet } from "@/app/auth/confirm/route";
import { seedTestData, cleanupTestData, type TestFixtures } from "../../fixtures/seed";
import { testEmail } from "../../support/run-id";
import { TEST_EMAIL_DOMAIN } from "../../support/env";
import { setMockVerifyOtpConfig, resetAuthMock } from "../../support/auth-mock";
import { RedirectSignal, resetNavigationMock } from "../../support/navigation-mock";

// Portal signup-confirmation defect fix — the exact end-to-end shape the
// real Production defect broke: portalSignup() generates a confirmation
// token and hands the resulting URL to (a fake standing in for) Resend;
// THIS test recovers that exact URL, parses it exactly like a real
// browser would after a real click, and feeds its query parameters into
// the REAL /auth/confirm Route Handler — proving the full chain (token
// generation -> emailed URL -> route's own query-param reading ->
// verifyOtp -> redirect -> explicit accept -> PortalUser creation)
// actually agrees end to end, and — critically — that this whole chain
// never invokes Staff provisioning logic (getOrCreateUser/
// getOrCreateOrganizationId) at any point.
//
// Does not require live Supabase or Resend network access: generateToken
// is injected, and the route's own verifyOtp() call goes through the
// shared, globally-mocked @/lib/supabase/server client
// (test/integration/setup-mocks.ts), configured per test via
// setMockVerifyOtpConfig().

function portalSignupForm(fields: { email: string; password: string; invitationToken?: string }): FormData {
  const formData = new FormData();
  formData.set("email", fields.email);
  formData.set("password", fields.password);
  formData.set("confirmPassword", fields.password);
  if (fields.invitationToken) formData.set("invitationToken", fields.invitationToken);
  return formData;
}

describe("Portal signup confirmation — real end-to-end shape (token generation -> emailed URL -> /auth/confirm -> verifyOtp -> redirect -> accept -> PortalUser)", () => {
  let fixtures: TestFixtures;

  beforeAll(async () => {
    fixtures = await seedTestData();
  });

  afterEach(() => {
    resetAuthMock();
    resetNavigationMock();
  });

  afterAll(async () => {
    await cleanupTestData(fixtures);
  });

  it("invited Portal signup, confirmation required: the emailed URL's token_hash/type/next survive intact into a real /auth/confirm request, which redirects to /portal/invite/<token>, and the subsequent explicit accept creates exactly one PortalUser and nothing Staff-related", async () => {
    const invitation = await prisma.clientInvitation.create({
      data: {
        clientId: fixtures.clientA.id,
        email: testEmail(`portal-e2e-invited-${randomUUID().slice(0, 8)}`, TEST_EMAIL_DOMAIN, fixtures.runId),
        token: randomUUID(),
        status: "PENDING",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        invitedById: fixtures.owner.id,
      },
    });

    let capturedConfirmUrl: string | undefined;
    const result = await portalSignup(
      { error: null },
      portalSignupForm({ email: invitation.email, password: "correct-horse-battery-1", invitationToken: invitation.token }),
      {
        generateToken: vi.fn().mockResolvedValue({ ok: true, tokenHash: "portal-e2e-real-token-hash", alreadyConfirmed: false }),
        sendConfirmationEmail: vi.fn().mockImplementation(async (params: { confirmUrl: string }) => {
          capturedConfirmUrl = params.confirmUrl;
          return { delivered: true };
        }),
      },
    );
    expect(result.message).toMatch(/check your email/i);
    expect(capturedConfirmUrl).toBeDefined();

    const parsed = new URL(capturedConfirmUrl!);
    expect(parsed.searchParams.get("token_hash")).toBe("portal-e2e-real-token-hash");
    expect(parsed.searchParams.get("type")).toBe("portal_signup");
    expect(parsed.searchParams.get("next")).toBe(`/portal/invite/${invitation.token}`);

    const userId = randomUUID();
    setMockVerifyOtpConfig({ kind: "success", user: { id: userId, email: invitation.email } });

    const confirmRequest = new Request(`http://localhost${parsed.pathname}${parsed.search}`);
    const response = await confirmGet(confirmRequest);
    expect(response.headers.get("location")).toBe(`http://localhost/portal/invite/${invitation.token}`);

    // Confirmation alone must never create anything — no PortalUser, no
    // Staff User, no Organization, no Membership.
    const userAfterConfirm = await prisma.user.findUnique({ where: { id: userId } });
    expect(userAfterConfirm).toBeNull();
    const portalUserAfterConfirm = await prisma.portalUser.findUnique({ where: { id: userId } });
    expect(portalUserAfterConfirm).toBeNull();

    // Explicit acceptance is the only place a PortalUser is ever created.
    await expect(acceptClientInvitationAction(invitation.token)).rejects.toBeInstanceOf(RedirectSignal);

    const portalUser = await prisma.portalUser.findUnique({ where: { id: userId } });
    expect(portalUser?.clientId).toBe(invitation.clientId);

    const memberships = await prisma.membership.findMany({ where: { userId } });
    expect(memberships).toHaveLength(0);
    const staffUser = await prisma.user.findUnique({ where: { id: userId } });
    expect(staffUser).toBeNull();

    await prisma.portalUser.deleteMany({ where: { id: userId } });
  });

  it("a missing token_hash on a portal_signup confirm request fails safely to /portal/signup?invalid=1", async () => {
    const response = await confirmGet(
      new Request("http://localhost/auth/confirm?type=portal_signup&next=%2Fportal"),
    );
    expect(response.headers.get("location")).toBe("http://localhost/portal/signup?invalid=1");
  });

  it("verifyOtp rejecting the token fails safely to /portal/signup?invalid=1, never a redirect to next", async () => {
    setMockVerifyOtpConfig({ kind: "error", message: "Token has expired or is invalid" });
    const response = await confirmGet(
      new Request("http://localhost/auth/confirm?token_hash=stale&type=portal_signup&next=%2Fportal"),
    );
    expect(response.headers.get("location")).toBe("http://localhost/portal/signup?invalid=1");
  });

  it("a portal_signup confirmation can never redirect to a Staff-only path even if next is tampered with", async () => {
    const userId = randomUUID();
    setMockVerifyOtpConfig({ kind: "success", user: { id: userId, email: testEmail("portal-e2e-tamper", TEST_EMAIL_DOMAIN) } });

    const response = await confirmGet(
      new Request("http://localhost/auth/confirm?token_hash=real&type=portal_signup&next=%2Fdashboard"),
    );
    expect(response.headers.get("location")).toBe("http://localhost/portal");

    await prisma.user.deleteMany({ where: { id: userId } });
  });
});
